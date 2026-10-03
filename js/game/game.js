// 게임 진행: 타이틀, 캐릭터 생성, 이야기, 도시(허브), 탑(필드), 메뉴, 사망(하드코어).
import { View } from '../engine/view.js';
import { Input } from '../engine/input.js';
import { loadAssets } from '../engine/assets.js';
import { Save, newState } from './save.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Enemies } from './enemies.js';
import { FX } from './fx.js';
import { HUD } from './hud.js';
import { Dialogue } from './dialogue.js';
import { fmt } from './korean.js';

const PERSONALITIES = ['열혈형', '냉철한 전략가', '다정한 보호자', '겁 많은 선인', '오만한 천재', '호기심 덩어리', '과묵한 고독자', '계산적 실리주의', '헌신적 신앙형', '자유로운 장난꾸러기'];
const PATTERN_JOB = { 공격: '천마', 수호: '불락의 성기사', 관찰: '정령왕의 사수', 탐구: '시공의 대현자', 구조: '신의 대행자', 은밀: '명왕' };
const STAT_NAMES = { str: '힘', agi: '민첩', int: '지능', spi: '정신', vit: '체력' };
const DAY_SECONDS = 60;
const DEADLINE = 365;
const OFFICE_PEOPLE = ['oh', 'wooseok', 'jiho', 'somi', 'haerin'];

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';

export class Game {
  constructor(canvas, overlay) {
    this.view = new View(canvas);
    this.input = new Input(canvas);
    this.ov = overlay;
    this.mode = 'loading';
    this.progress = [0, 1];
    this.hitstop = 0; this.comboN = 0; this.comboT = 0;
    this.dialogue = new Dialogue(this);
    this.hud = new HUD(this);
    this.hubTab = 'office';
    this.input.on('attack', () => this.mode === 'field' && this.player.attack());
    this.input.on('dodge', (dx, dy) => this.mode === 'field' && this.player.dodge(dx, dy));
    this.input.on('tap', (x, y) => { if (this.mode === 'dialogue') this.dialogue.tap(x, y); });
  }

  async getJSON(u) { return (await fetch(u + '?v=' + (this.ver || Date.now()), { cache: 'no-cache' })).json(); }

  async boot() {
    this.A = await loadAssets('data/manifest.json', (d, t) => (this.progress = [d, t]));
    this.ver = this.A.version;
    const names = ['jobs', 'monsters', 'npcs', 'items', 'shop', 'floors', 'barks', 'news'];
    const data = await Promise.all(names.map((n) => this.getJSON(`data/${n}.json`)));
    names.forEach((n, i) => (this[n] = data[i]));
    this.mapTemplate = await this.getJSON('data/maps/floor01.json');
    this.npcById = Object.fromEntries(this.npcs.map((n) => [n.id, n]));
    this.showTitle();
  }

  // ---------- 공통 계산 ----------
  get npcsState() { return this.state.npcs; }
  npcName(id) { const n = this.npcById[id]; if (!n) return id; return this.state && this.state.gender === 'f' && n.nameIfFemalePlayer ? n.nameIfFemalePlayer : n.name; }
  equipStat(k) { const s = this.state; let v = 0; for (const slot in s.equip) { const it = this.items[s.equip[slot]]; if (it && it[k]) v += it[k]; } return v; }
  expNeed() { return Math.floor(20 * Math.pow(this.state.lv, 1.6)); }
  maxHp() { const s = this.state; return 100 + s.stats.vit * 10 + (s.lv - 1) * 5 + this.equipStat('hp'); }
  recordPattern(k, amt) { this.state.pattern[k] = (this.state.pattern[k] || 0) + amt; }
  combo() { this.comboN++; this.comboT = 1.6; }

  save() {
    if (!this.state) return;
    if (this.player && this.player.state === 'dead') return;
    Save.write(this.state);
  }

  // ---------- 타이틀과 생성 ----------
  showTitle() {
    this.mode = 'title'; this.input.mode = 'menu'; this.world = null; this.floor = null;
    const has = Save.has();
    this.ov.innerHTML = `<div class="screen"><div class="title">
      <h1>각성</h1><p>AWAKENING</p>
      <div class="stack">
        ${has ? '<button class="primary" id="cont">이어하기</button>' : ''}
        <button id="new">${has ? '새로 시작 (기존 기록 삭제)' : '새로 시작'}</button>
      </div></div></div>`;
    if (has) this.ov.querySelector('#cont').onclick = () => this.continueGame();
    this.ov.querySelector('#new').onclick = () => this.showCreate();
  }

  showCreate() {
    this.mode = 'create';
    let gender = 'm';
    this.ov.innerHTML = `<div class="screen"><div class="card">
      <h2>나의 이름</h2>
      <div class="row">
        <div class="field" style="flex:0 0 32%"><label for="fam">성</label><input id="fam" maxlength="3" autocomplete="off"></div>
        <div class="field"><label for="giv">이름</label><input id="giv" maxlength="5" autocomplete="off"></div>
      </div>
      <p class="hint">대사에서는 주로 이름으로 불리고, 뉴스나 공식 호명처럼 특별한 상황에서만 성까지 불려요.</p>
      <div class="field"><label>성별</label><div class="seg"><button id="gm" class="on">남자</button><button id="gf">여자</button></div></div>
      <p class="hint">외형 꾸미기는 디자인이 완성되면 추가돼요. 죽으면 기록이 사라지는 하드코어 게임이에요.</p>
      <button class="primary" id="go" disabled>시작하기</button>
    </div></div>`;
    const $ = (q) => this.ov.querySelector(q);
    const fam = $('#fam'), giv = $('#giv'), go = $('#go'), gm = $('#gm'), gf = $('#gf');
    const check = () => { go.disabled = !(fam.value.trim() && giv.value.trim()); };
    fam.oninput = check; giv.oninput = check;
    gm.onclick = () => { gender = 'm'; gm.classList.add('on'); gf.classList.remove('on'); };
    gf.onclick = () => { gender = 'f'; gf.classList.add('on'); gm.classList.remove('on'); };
    go.onclick = () => {
      Save.wipe();
      const s = (this.state = newState(fam.value.trim(), giv.value.trim(), gender));
      s.npcs = {};
      for (const n of this.npcs) s.npcs[n.id] = { personality: n.fixed || PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)] };
      s.hp = this.maxHp();
      this.save();
      this.clearOverlay();
      this.playScene('prologue_intro', () => { s.flags.introDone = true; this.save(); this.goHub(); });
    };
  }

  continueGame() {
    const st = Save.load();
    if (!st) { this.showTitle(); return; }
    this.state = st;
    if (!st.flags.introDone) { this.clearOverlay(); this.playScene('prologue_intro', () => { st.flags.introDone = true; this.save(); this.goHub(); }); }
    else this.goHub();
  }

  clearOverlay() { this.ov.innerHTML = ''; }

  // ---------- 이야기 ----------
  playScene(id, onEnd) {
    this.getJSON(`data/dialogue/${id}.json`).then((scene) => {
      this.prevMode = this.mode;
      this.mode = 'dialogue'; this.input.mode = 'dialogue'; this.input.reset();
      this.ov.querySelectorAll('.fieldbtn').forEach((b) => (b.style.display = 'none'));
      this.dialogue.start(scene, () => { onEnd && onEnd(); });
    });
  }

  // ---------- 도시 ----------
  goHub(tab) {
    this.mode = 'hub'; this.input.mode = 'menu'; this.input.reset();
    this.world = null; this.floor = null; this.player = null;
    if (tab) this.hubTab = tab;
    this.renderHub();
  }

  newsLines() {
    const s = this.state;
    return this.news.filter((n) => {
      const c = n.if || {};
      if (c.minRumor && s.rumor < c.minRumor) return false;
      if (c.minDay && s.day < c.minDay) return false;
      if (c.maxDay && s.day > c.maxDay) return false;
      return true;
    }).map((n) => n.text);
  }

  renderHub() {
    const s = this.state;
    const dleft = Math.max(0, DEADLINE - s.day);
    const tabs = [['office', '사무소'], ['shop', '상점'], ['gear', '장비'], ['tower', '탑'], ['home', '집']];
    let body = '';
    if (this.hubTab === 'office') body = this.hubOffice();
    if (this.hubTab === 'shop') body = this.hubShop();
    if (this.hubTab === 'gear') body = this.hubGear();
    if (this.hubTab === 'tower') body = this.hubTower();
    if (this.hubTab === 'home') body = this.hubHome();
    this.ov.innerHTML = `<div class="screen hub"><div class="card wide">
      <div class="hubhead"><b>${esc(fmt('{성이름}', s))}</b> <span>Lv.${s.lv} · ${esc(s.job)}${s.phase === 'porter' ? ' (짐꾼)' : ''}</span>
      <span class="right">${won(s.money)} · 31층 기한 D-${dleft}</span></div>
      <div class="tabs">${tabs.map(([k, n]) => `<button data-tab="${k}" class="${this.hubTab === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="hubbody">${body}</div>
      <p class="hint" id="msg"></p>
    </div></div>`;
    this.ov.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { this.hubTab = b.dataset.tab; this.renderHub(); }));
    this.ov.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => this.hubAction(b.dataset.act, b.dataset.arg)));
    if (this.hubMsg) { this.ov.querySelector('#msg').textContent = this.hubMsg; this.hubMsg = ''; }
  }

  hubOffice() {
    const s = this.state, news = this.newsLines().slice(-3).reverse();
    const people = OFFICE_PEOPLE.map((id) => {
      const talked = s.talked[id] === s.day;
      return `<div class="stat"><span>${esc(this.npcName(id))} <small>${esc(this.npcById[id].role)}</small></span><button data-act="talk" data-arg="${id}" ${talked ? 'disabled' : ''}>${talked ? '오늘 대화함' : '말 걸기'}</button></div>`;
    }).join('');
    const line = this.lastBark ? `<div class="bark"><b>${esc(this.lastBark[0])}</b> ${esc(this.lastBark[1])}</div>` : '';
    this.lastBark = null;
    return `<div class="news">${news.map((n) => `<div>📰 ${esc(n)}</div>`).join('')}</div>${line}${people}
      <p class="hint">의뢰는 탑 탭에서 층에 들어가 목표를 채우면 끝나요.</p>`;
  }

  hubShop() {
    const s = this.state;
    const rows = this.shop.sell.map((id) => {
      const it = this.items[id];
      const info = it.atk ? `공격 +${it.atk}` : it.hp ? `체력 +${it.hp}` : it.heal ? `회복 ${it.heal}` : it.desc || '';
      return `<div class="stat"><span>${esc(it.name)} <small>${esc(it.rarity)} · ${esc(info)} · 보유 ${s.inv[id] || 0}</small></span><button data-act="buy" data-arg="${id}" ${s.money < it.price ? 'disabled' : ''}>${won(it.price)}</button></div>`;
    }).join('');
    const shard = s.inv.mana_shard || 0;
    return `${rows}<div class="stat"><span>마정석 조각 <small>보유 ${shard} · 개당 ${won(this.items.mana_shard.sell)}</small></span><button data-act="sellshards" ${shard ? '' : 'disabled'}>모두 팔기</button></div>`;
  }

  hubGear() {
    const s = this.state;
    const gear = Object.keys(s.inv).filter((id) => s.inv[id] > 0 && this.items[id] && ['weapon', 'outfit'].includes(this.items[id].slot));
    const rows = gear.map((id) => {
      const it = this.items[id], on = s.equip[it.slot] === id;
      return `<div class="stat"><span>${esc(it.name)} <small>${it.slot === 'weapon' ? '무기 · 공격 +' + it.atk : '옷 · 체력 +' + it.hp}</small></span><button data-act="equip" data-arg="${id}" ${on ? 'disabled' : ''}>${on ? '장착 중' : '장착'}</button></div>`;
    }).join('');
    const main = (this.jobs[s.job] || {}).main || [];
    const stats = Object.keys(STAT_NAMES).map((k) => `<div class="stat"><span>${STAT_NAMES[k]} <b>${s.stats[k]}</b>${main.includes(k) ? ' <small>주 스탯</small>' : ''}</span><button data-act="stat" data-arg="${k}" ${s.pts ? '' : 'disabled'}>+1</button></div>`).join('');
    return `<p class="hint">남은 스탯 포인트 ${s.pts} · 체력 ${Math.round(s.hp)} / ${this.maxHp()} · 경험치 ${s.exp} / ${this.expNeed()}</p>${stats}<h3>장비</h3>${rows}`;
  }

  hubTower() {
    const s = this.state;
    const max = s.phase === 'porter' ? 10 : Math.min(this.floors.length, s.unlocked);
    let rows = '';
    for (let i = 1; i <= Math.min(max, this.floors.length); i++) {
      const f = this.floors[i - 1];
      const open = s.phase === 'porter' ? i <= Math.max(s.unlocked, 1) : i <= s.unlocked;
      const label = s.phase === 'porter' && i === 10 ? '들꽃 파티 동행 의뢰' : s.cleared[i] ? '돌파함' : '';
      rows += `<div class="stat"><span>${esc(f.name)} <small>${label}</small></span><button data-act="enter" data-arg="${i}" ${open ? '' : 'disabled'}>${open ? '들어가기' : '잠김'}</button></div>`;
    }
    const note = s.phase === 'porter' ? '짐꾼으로 파티를 따라 층에 들어가요. 9층까지 의뢰를 마치면 10층 의뢰가 열려요.' : '정체를 숨긴 채 들어가요. 층의 목표를 채우면 보스가 나타나요.';
    return `<p class="hint">${note}</p>${rows}`;
  }

  hubHome() {
    return `<div class="stat"><span>휴식 <small>체력을 회복하고 하루를 보냄</small></span><button data-act="rest">쉬기</button></div>
      <div class="stat"><span>저장</span><button data-act="save">저장</button></div>
      <div class="stat"><span>타이틀로</span><button data-act="title">나가기</button></div>`;
  }

  hubAction(act, arg) {
    const s = this.state;
    if (act === 'talk') {
      const p = s.npcs[arg].personality;
      const lines = this.barks[p] || ['…'];
      this.lastBark = [this.npcName(arg), lines[Math.floor(Math.random() * lines.length)]];
      s.talked[arg] = s.day; s.aff[arg] = (s.aff[arg] || 0) + 1;
    } else if (act === 'buy') {
      const it = this.items[arg];
      if (s.money >= it.price) { s.money -= it.price; s.inv[arg] = (s.inv[arg] || 0) + 1; this.hubMsg = it.name + ' 구입'; }
    } else if (act === 'sellshards') {
      const n = s.inv.mana_shard || 0; s.money += n * this.items.mana_shard.sell; s.inv.mana_shard = 0; this.hubMsg = '마정석 조각 ' + n + '개를 팔았어요';
    } else if (act === 'equip') {
      const it = this.items[arg]; s.equip[it.slot] = arg; s.hp = Math.min(s.hp, this.maxHp());
    } else if (act === 'stat') {
      if (s.pts > 0) { s.stats[arg]++; s.pts--; }
    } else if (act === 'enter') {
      this.enterFloor(Number(arg)); return;
    } else if (act === 'rest') {
      s.day++; s.dayT = 0; s.hp = this.maxHp(); this.hubMsg = '푹 쉬었어요. 하루가 지났어요.'; this.save();
    } else if (act === 'save') {
      this.save(); this.hubMsg = '저장했어요';
    } else if (act === 'title') {
      this.save(); this.showTitle(); return;
    }
    this.renderHub();
  }

  // ---------- 탑 ----------
  enterFloor(n) {
    const s = this.state, f = this.floors[n - 1];
    if (s.phase === 'porter' && n === 10) { this.startRift(); return; }
    this.floor = f; this.kills = 0; this.boss = null; this.floorDone = false;
    const map = Object.assign({}, this.mapTemplate, { seed: f.seed });
    this.world = new World(this.A, map);
    this.fx = new FX(this.A, this.view);
    this.player = new Player(this, this.world.spawn.x, this.world.spawn.y);
    this.enemies = new Enemies(this, this.monsters, f);
    this.view.cam.x = this.player.x; this.view.cam.y = this.player.y;
    this.mode = 'field'; this.input.mode = 'field';
    this.fieldButtons();
    this.hud.hintT = s.cleared[1] ? 0 : 7;
  }

  goalText() {
    const f = this.floor; if (!f) return '';
    if (this.floorDone) return '목표 완료';
    if (this.boss) return '보스를 쓰러뜨리세요';
    return `목표 처치 ${this.kills} / ${f.goal}`;
  }

  fieldButtons() {
    const s = this.state;
    this.ov.innerHTML = `<button id="menuBtn" class="fieldbtn">메뉴</button><button id="potBtn" class="fieldbtn">물약 ${s.inv.potion || 0}</button>`;
    this.ov.querySelector('#menuBtn').onclick = () => this.showFieldMenu();
    this.ov.querySelector('#potBtn').onclick = () => this.usePotion();
  }

  usePotion() {
    const s = this.state;
    if (this.mode !== 'field' || !(s.inv.potion > 0) || this.player.state === 'dead') return;
    s.inv.potion--; s.hp = Math.min(this.maxHp(), s.hp + this.items.potion.heal);
    this.fx.num(this.player.x, this.player.y - 140, '+' + this.items.potion.heal, 'exp');
    this.ov.querySelector('#potBtn').textContent = '물약 ' + s.inv.potion;
  }

  showFieldMenu() {
    if (this.mode !== 'field') return;
    this.mode = 'menu'; this.input.mode = 'menu'; this.input.reset();
    const s = this.state;
    const canReturn = (s.inv.return_stone || 0) > 0 && !this.boss;
    this.ov.innerHTML = `<div class="screen"><div class="card">
      <h2>${esc(this.floor.name)}</h2>
      <p class="hint">${esc(this.goalText())} · 체력 ${Math.round(s.hp)} / ${this.maxHp()} · 귀환석 ${s.inv.return_stone || 0}</p>
      ${s.pts ? `<p class="hint">스탯 포인트 ${s.pts}개가 남아 있어요. 도시의 장비 탭에서 분배할 수 있어요.</p>` : ''}
      <div class="row"><button id="ret" style="flex:1" ${canReturn ? '' : 'disabled'}>귀환석 사용</button></div>
      ${this.boss ? '<p class="hint">보스와 싸우는 중에는 귀환석을 쓸 수 없어요.</p>' : ''}
      <button class="primary" id="back">계속하기</button>
    </div></div>`;
    this.ov.querySelector('#ret').onclick = () => { s.inv.return_stone--; this.save(); this.goHub('home'); };
    this.ov.querySelector('#back').onclick = () => { this.mode = 'field'; this.input.mode = 'field'; this.fieldButtons(); };
  }

  onKill(e) {
    const s = this.state;
    s.kills++; this.kills++;
    s.sp = Math.min(60, s.sp + 4);
    const gain = e.d.exp;
    s.exp += gain;
    this.fx.num(e.x, e.y - 100, '+' + gain + ' EXP', 'exp');
    if (e.d.money) s.money += Math.round(e.d.money[0] + Math.random() * (e.d.money[1] - e.d.money[0]));
    if (e.d.drop) for (const id in e.d.drop) if (Math.random() < e.d.drop[id]) s.inv[id] = (s.inv[id] || 0) + 1;
    if (s.phase !== 'porter') s.rumor += 0.02;
    while (s.lv < 100 && s.exp >= this.expNeed()) {
      s.exp -= this.expNeed(); s.lv++; s.pts += 5; s.hp = this.maxHp();
      this.hud.say('레벨 업! Lv.' + s.lv + ' · 스탯 포인트 +5');
    }
    const f = this.floor;
    if (e === this.boss) { this.clearFloor(); return; }
    if (!this.floorDone && !this.boss && this.kills >= f.goal) {
      if (s.phase === 'porter') this.clearFloor();
      else { this.boss = this.enemies.spawnBoss(f.boss); this.hud.say('강한 기운이 다가온다'); }
    }
  }

  clearFloor() {
    const s = this.state, n = this.floor.n;
    this.floorDone = true;
    const first = !s.cleared[n];
    s.cleared[n] = true;
    s.unlocked = Math.max(s.unlocked, n + 1);
    if (s.phase !== 'porter' && first) s.rumor += 1;
    const pay = s.phase === 'porter' ? 30000 + n * 8000 : 0;
    s.money += pay;
    this.save();
    setTimeout(() => {
      if (this.mode !== 'field') return;
      this.mode = 'menu'; this.input.mode = 'menu'; this.input.reset();
      const next = n + 1 <= this.floors.length && (s.phase !== 'porter' || n + 1 < 10);
      this.ov.innerHTML = `<div class="screen"><div class="card">
        <h2>${esc(this.floor.name)} ${s.phase === 'porter' ? '의뢰 완료' : '돌파'}</h2>
        <p class="hint">${pay ? '짐꾼 일당 ' + won(pay) + ' · ' : ''}보유 ${won(s.money)}</p>
        ${s.phase === 'porter' && n === 9 ? '<p class="hint">10층 들꽃 파티 동행 의뢰가 열렸어요.</p>' : ''}
        <div class="row"><button id="home" style="flex:1">도시로</button>${next ? '<button id="next" style="flex:1">다음 층으로</button>' : ''}</div>
      </div></div>`;
      this.ov.querySelector('#home').onclick = () => this.goHub('tower');
      if (next) this.ov.querySelector('#next').onclick = () => this.enterFloor(n + 1);
    }, 1500);
  }

  startRift() {
    const s = this.state;
    this.goHub('tower');
    this.clearOverlay();
    this.playScene('rift', () => {
      const ranked = Object.entries(s.pattern).sort((a, b) => b[1] - a[1]);
      s.job = PATTERN_JOB[ranked[0][0]];
      s.phase = 'hidden';
      s.flags.masked = true;
      let spent = 0; for (const k in s.stats) { spent += s.stats[k] - 5; s.stats[k] = 5; }
      s.pts += spent;
      s.unlocked = 1;
      s.cleared = {};
      s.hp = this.maxHp();
      this.save();
      this.playScene('awaken', () => { this.save(); this.goHub('gear'); this.hubMsg = '스탯 포인트를 다시 분배하세요. 주 스탯을 올리면 데미지가 강해져요.'; this.renderHub(); });
    });
  }

  onPlayerDeath() { Save.wipe(); setTimeout(() => this.showEnd(), 2600); }

  showEnd() {
    this.mode = 'end'; this.input.mode = 'menu';
    const s = this.state;
    this.ov.innerHTML = `<div class="screen"><div class="card end">
      <h2>${esc(s.given)}의 이야기는 여기서 끝났습니다</h2>
      <p class="hint">Lv.${s.lv} · ${esc(s.job)} · 처치 ${s.kills} · 31층 기한 D-${Math.max(0, DEADLINE - s.day)}</p>
      <p class="hint">하드코어 게임이라 이 기록은 사라졌어요.</p>
      <button class="primary" id="tt">처음으로</button>
    </div></div>`;
    this.ov.querySelector('#tt').onclick = () => this.showTitle();
  }

  // ---------- 매 프레임 ----------
  update(dt) {
    this.view.update(dt);
    this.hud.update(dt);
    if (this.mode === 'dialogue') { this.dialogue.update(dt); if (!this.dialogue.active && this.mode === 'dialogue') this.mode = this.prevMode; return; }
    if (this.mode !== 'field' && this.mode !== 'end') return;
    if (!this.world) return;
    if (this.hitstop > 0) { this.hitstop -= dt; for (const f of this.fx.list) f.t += dt * 0.3; return; }
    const s = this.state;
    this.comboT = Math.max(0, this.comboT - dt); if (this.comboT <= 0) this.comboN = 0;
    this.player.update(dt);
    this.enemies.update(dt);
    this.fx.update(dt);
    this.view.follow(this.player.x, this.player.y, dt, { w: this.world.w, h: this.world.h });
    if (this.mode === 'field' && this.player.state !== 'dead') {
      s.dayT += dt;
      if (s.dayT >= DAY_SECONDS) { s.dayT -= DAY_SECONDS; s.day++; }
      s.sp = Math.min(60, s.sp + dt * 0.5);
    }
  }

  render() {
    const v = this.view, ctx = v.ctx;
    v.screen();
    ctx.fillStyle = '#14110f'; ctx.fillRect(0, 0, v.W, v.H);
    if (this.mode === 'loading') {
      ctx.fillStyle = '#f3e3b5'; ctx.font = '15px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(`불러오는 중 ${this.progress[0]} / ${this.progress[1]}`, v.W / 2, v.H / 2); ctx.textAlign = 'left';
      return;
    }
    if (this.world) {
      v.world();
      this.world.drawGround(v);
      this.fx.draw(true);
      const list = [];
      this.world.collectProps(v, list);
      this.enemies.collect(list);
      this.player.collect(list);
      list.sort((a, b) => a.y - b.y).forEach((o) => o.d());
      this.fx.draw(false);
      this.player.drawSwords();
      this.fx.drawNums();
      v.screen();
      this.hud.draw();
    } else {
      const g = ctx.createRadialGradient(v.W / 2, v.H / 2, 40, v.W / 2, v.H / 2, Math.max(v.W, v.H) * 0.7);
      g.addColorStop(0, '#2a2018'); g.addColorStop(1, '#0d0a08');
      ctx.fillStyle = g; ctx.fillRect(0, 0, v.W, v.H);
    }
    if (this.mode === 'dialogue') this.hud.drawDialogue(this.dialogue);
  }
}

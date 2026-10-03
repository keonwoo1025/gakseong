// 게임 진행: 타이틀 → 생성 → 컷신과 걸어 다니는 장소(포켓몬·제노니아식) → 짐꾼 원정 → 균열과 각성 → 탑 전투.
import { View } from '../engine/view.js';
import { Input } from '../engine/input.js';
import { loadAssets } from '../engine/assets.js';
import { Sound } from '../engine/audio.js';
import { Save, newState } from './save.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Enemies } from './enemies.js';
import { FX } from './fx.js';
import { HUD } from './hud.js';
import { Dialogue } from './dialogue.js';
import { fmt } from './korean.js';
import { Overworld } from './overworld.js';
import { PorterRun } from './porter.js';
import { makePortrait } from './pixel.js';
import { Settings } from '../engine/settings.js';

const PERSONALITIES = ['열혈형', '냉철한 전략가', '다정한 보호자', '겁 많은 선인', '오만한 천재', '호기심 덩어리', '과묵한 고독자', '계산적 실리주의', '헌신적 신앙형', '자유로운 장난꾸러기'];
const PATTERN_JOB = { 공격: '천마', 수호: '불락의 성기사', 관찰: '정령왕의 사수', 탐구: '시공의 대현자', 구조: '신의 대행자', 은밀: '명왕' };
const STAT_NAMES = { str: '힘', agi: '민첩', int: '지능', spi: '정신', vit: '체력' };
const DEADLINE = 365;
const LIVING_COST = 25000;
const WAGE = 40000, SHARD_BONUS = 1500;

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
    this.sound = new Sound();
    this.ow = new Overworld(this);
    this.fx = null;
    this.talking = false;
    this.portraits = {};
    this.input.on('button', (id) => {
      if (this.talking || this.menuOpen || (this.mode === 'world' && this.ow.cut)) return;
      if (id === 'menu') return this.openMenu();
      if (id === 'act') {
        if (this.mode === 'world') this.ow.interact();
        else if (this.mode === 'porter') this.porter.interact();
        else if (this.mode === 'field') this.player.attack();
      }
      if (id === 'dodge') { if (this.mode === 'porter') this.porter.dodge(0, 0); else if (this.mode === 'field') this.player.dodge(0, 0); }
      if (id === 'skill1' && this.mode === 'field') this.player.skill();
      if (id === 'potion') this.quickHeal();
    });
    this.input.on('dodge', (dx, dy) => {
      if (this.talking || this.menuOpen) return;
      if (this.mode === 'porter') this.porter.dodge(dx, dy);
      else if (this.mode === 'field') this.player.dodge(dx, dy);
    });
    this.input.on('tap', (x, y) => { if (this.talking) this.dialogue.tap(x, y); });
  }

  async getJSON(u) { return (await fetch(u + '?v=' + (this.ver || Date.now()), { cache: 'no-cache' })).json(); }

  async boot() {
    this.A = await loadAssets('data/manifest.json', (d, t) => (this.progress = [d, t]));
    this.ver = this.A.version + '.' + Date.now().toString(36).slice(-3);
    const names = ['jobs', 'monsters', 'npcs', 'items', 'shop', 'store', 'floors', 'barks', 'news', 'music', 'looks', 'citymap'];
    const data = await Promise.all(names.map((n) => this.getJSON(`data/${n}.json`)));
    names.forEach((n, i) => (this[n] = data[i]));
    this.mapTemplate = await this.getJSON('data/maps/floor01.json');
    this.npcById = Object.fromEntries(this.npcs.map((n) => [n.id, n]));
    this.sound.setTracks(this.music);
    this.showTitle();
  }

  // ---------- 공통 ----------
  check(c) {
    if (!c) return true;
    const s = this.state;
    if (!s) return false;
    if (c.flag && !s.flags[c.flag]) return false;
    if (c.noflag && s.flags[c.noflag]) return false;
    if (c.gender && s.gender !== c.gender) return false;
    if (c.phase && s.phase !== c.phase) return false;
    if (c.notPhase && s.phase === c.notPhase) return false;
    if (c.job && s.job !== c.job) return false;
    return true;
  }
  fmt(t) { return fmt(t, this.state || {}); }
  pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  aff(id, n) { this.state.aff[id] = (this.state.aff[id] || 0) + n; }
  toast(t) { this.hud.say(t, 2.6); }
  recordPattern(k, amt) { this.state.pattern[k] = (this.state.pattern[k] || 0) + amt; }
  combo() { this.comboN++; this.comboT = 1.6; }
  equipStat(k) { const s = this.state; let v = 0; for (const slot in s.equip) { const it = this.items[s.equip[slot]]; if (it && it[k]) v += it[k]; } return v; }
  expNeed() { return Math.floor(20 * Math.pow(this.state.lv, 1.6)); }
  maxHp() { const s = this.state; return 100 + s.stats.vit * 10 + (s.lv - 1) * 5 + this.equipStat('hp'); }
  awakened() { return this.state.phase !== 'porter'; }

  npcName(id) { const n = this.npcById[id]; if (!n) return id; return this.state && this.state.gender === 'f' && n.nameIfFemalePlayer ? n.nameIfFemalePlayer : n.name; }
  lookOf(id) {
    if (id === 'player') return this.playerLook();
    if (id === 'seoyun') return this.looks[this.state && this.state.gender === 'f' ? 'seoyun_m' : 'seoyun_f'];
    return this.looks[id] || { top: '#777', bottom: '#444' };
  }
  playerLook() { return this.looks[this.state && this.state.gender === 'f' ? 'player_f' : 'player_m']; }
  speakerName(id) { if (id === 'player') return this.state.given; if (this.npcById[id]) return this.npcName(id); return id; }
  portraitKey(id, override) { if (override) return override; if (id === 'player' || this.npcById[id] || this.looks[id]) return 'gen:' + id; return null; }
  portraitOf(key) {
    if (!key) return null;
    if (key.startsWith('gen:')) { const id = key.slice(4); if (!this.portraits[id]) this.portraits[id] = makePortrait(this.lookOf(id)); return this.portraits[id]; }
    return this.A.portraits[key] || null;
  }

  runLine(line, cb) {
    this.talking = true;
    this.dialogue.start({ lines: [line] }, () => { this.talking = false; cb && cb(); });
  }
  runLines(lines, cb) {
    this.talking = true;
    this.dialogue.start({ lines }, () => { this.talking = false; cb && cb(); });
  }

  save() {
    const s = this.state; if (!s || s.dead) return;
    if (this.mode === 'world' && this.ow.map && this.ow.actors.player) { s.map = this.ow.map.id; s.pos = [Math.floor(this.ow.actors.player.x / 80), Math.floor((this.ow.actors.player.y - 10) / 80)]; }
    Save.write(s);
  }

  // ---------- 타이틀과 생성 ----------
  showTitle() {
    this.mode = 'title'; this.ow.map = null; this.world = null;
    this.sound.play('title');
    const has = Save.has();
    this.ov.innerHTML = `<div class="screen"><div class="title">
      <h1>각성</h1><p>AWAKENING</p>
      <div class="stack">
        ${has ? '<button class="primary" id="cont">이어하기</button>' : ''}
        <button id="new">${has ? '새로 시작 (기존 기록 삭제)' : '새로 시작'}</button>
        <button id="snd">${this.sound.enabled ? '배경음 끄기' : '배경음 켜기'}</button>
      </div></div></div>`;
    if (has) this.ov.querySelector('#cont').onclick = () => this.continueGame();
    this.ov.querySelector('#new').onclick = () => this.showCreate();
    this.ov.querySelector('#snd').onclick = (e) => { const on = this.sound.toggle(); e.target.textContent = on ? '배경음 끄기' : '배경음 켜기'; };
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
      for (const n of this.npcs) s.npcs[n.id] = { personality: n.fixed || this.pick(PERSONALITIES) };
      s.hp = this.maxHp();
      this.portraits = {};
      this.ow.actors = {};
      this.enterWorldMode();
      this.ow.play('prologue');
    };
  }

  continueGame() {
    const st = Save.load();
    if (!st) { this.showTitle(); return; }
    this.state = st; this.portraits = {}; this.ow.actors = {};
    this.enterWorldMode();
    if (!st.flags.introDone) { this.ow.play('prologue'); return; }
    const gone = { street: 'alley' };
    if (gone[st.map]) { st.map = gone[st.map]; st.pos = null; }
    this.ow.load(st.map || 'room', st.pos || null);
  }

  enterWorldMode() {
    this.mode = 'world'; this.world = null; this.porter = null;
    this.fx = new FX(this.A, this.view);
    this.worldButtons();
  }

  worldButtons() {
    this.ov.innerHTML = `<button id="menuBtn" class="fieldbtn">메뉴</button>`;
    this.ov.querySelector('#menuBtn').onclick = () => this.openMenu();
  }

  zoomForMode() { if (this.mode === 'world') this.view.setZoom(64, 1); else this.view.setZoom(96, 1.12); }

  // ---------- 말 걸기와 조사 ----------
  talkTo(npc, actor) {
    const s = this.state, id = npc.id;
    if (npc.talk === 'line') { this.runLine({ speaker: this.npcName(id), portrait: this.portraitKey(id), text: this.fmt(npc.text) }); return; }
    if (npc.talk === 'bark') {
      const lines = this.barks[s.npcs[id] ? s.npcs[id].personality : ''] || ['…'];
      if (s.talked[id] !== s.day) { s.talked[id] = s.day; this.aff(id, 1); }
      this.runLine({ speaker: this.npcName(id), portrait: this.portraitKey(id), text: this.pick(lines) });
      return;
    }
    if (npc.talk === 'job') return this.talkBoss();
    if (npc.talk === 'leader') {
      this.runLine({ speaker: this.npcName(id), portrait: this.portraitKey(id), text: s.porterDepth >= 9 ? '오늘은 10층 보스방 앞까지 간다. 단단히 챙겨.' : '짐 챙겼지? 출발할까?', choices: [{ text: '출발한다', flag: '_go' }, { text: '잠깐만' }] }, () => {
        if (s.flags._go) { delete s.flags._go; this.startExpedition(); }
      });
      return;
    }
    if (npc.talk === 'store') return this.openShop(this.store.sell, '편의점');
    if (npc.talk === 'shop') return this.openShop(this.shop.sell, '헌터 상점');
  }

  talkBoss() {
    const s = this.state, k = this.portraitKey('oh'), n = this.npcName('oh');
    if (this.awakened()) { this.runLine({ speaker: n, portrait: k, text: this.pick(['얼굴 좋아졌네. 무슨 일 있었냐.', '요즘 안 보이더라. 어디서 뭘 하든, 살아서 다녀라.', '짐꾼 일은 안 하냐? …그래, 잘됐다.']) }); return; }
    if (s.flags.jobToday) { this.runLine({ speaker: n, portrait: k, text: '광장에서 들꽃 파티 기다린다. 늦지 마.' }); return; }
    if (s.flags.workedToday) { this.runLine({ speaker: n, portrait: k, text: '오늘 일은 끝났다. 들어가서 쉬어.' }); return; }
    this.runLine({ speaker: n, portrait: k, text: '들꽃 파티 동행 건 있다. 일당 4만 원에 회수 수당 따로. 할래?', choices: [{ text: '하겠습니다', flag: '_job' }, { text: '오늘은 쉴게요' }] }, () => {
      if (s.flags._job) {
        delete s.flags._job; s.flags.jobToday = true; s.objective = '탑 입구 광장에서 들꽃 파티와 합류하기 (거리 오른쪽 끝)';
        this.runLine({ speaker: n, portrait: k, text: '구급상자는 챙겼냐. 없으면 편의점 들렀다 가.' });
      }
    });
  }

  useObject(o) {
    const s = this.state;
    if (o.act === 'text') { this.runLine({ text: this.fmt(o.text) }); return; }
    if (o.act === 'news') {
      const news = this.newsLines(); this.runLine({ speaker: '뉴스', text: this.pick(news) }); return;
    }
    if (o.act === 'sleep') return this.sleep();
    if (o.act === 'gate') {
      if (!this.awakened()) {
        this.runLine({ text: s.flags.jobToday ? '파티 리더에게 말을 걸어 출발하자.' : '짐꾼은 소속 파티와 함께만 들어갈 수 있다.' });
        return;
      }
      return this.openFloorSelect();
    }
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

  sleep() {
    const s = this.state;
    this.runLine({ text: '잠자리에 들까?', choices: [{ text: '잔다', flag: '_sleep' }, { text: '아직' }] }, () => {
      if (!s.flags._sleep) return;
      delete s.flags._sleep;
      s.day++; s.money -= LIVING_COST; s.hp = this.maxHp();
      s.flags.workedToday = false; s.flags.jobToday = false;
      s.objective = this.awakened() ? '탑 입구 광장에서 탑에 오르기' : '짐꾼 사무소에서 의뢰 받기';
      this.ow.fadeTo = 1;
      setTimeout(() => {
        this.ow.fadeTo = 0;
        this.runLine({ text: `하루가 지났다. 월세와 식비로 ${won(LIVING_COST)}이 나갔다. 남은 돈 ${won(s.money)}.${s.money < 0 ? ' 통장이 마이너스다.' : ''}\n31층 기한 D-${Math.max(0, DEADLINE - s.day)}.` });
        this.save();
      }, 700);
    });
  }

  // ---------- 컷신에서 부르는 기능 ----------
  cutCall(name, arg, next) {
    const s = this.state;
    if (name === 'startPorterLife') {
      s.objective = '사장님에게 말을 걸어 의뢰 받기';
      this.save();
      return;
    }
    if (name === 'awaken') {
      const ranked = Object.entries(s.pattern).sort((a, b) => b[1] - a[1]);
      s.job = PATTERN_JOB[ranked[0][0]];
      this.ow.play('awaken');
      return 'async';
    }
    if (name === 'afterAwaken') {
      s.phase = 'hidden'; s.flags.masked = true;
      s.lv = 1; s.exp = 0; s.pts = 5;
      for (const k in s.stats) s.stats[k] = 5;
      s.unlocked = 1; s.cleared = {};
      s.hp = this.maxHp();
      s.flags.jobToday = false; s.flags.workedToday = true;
      s.objective = '메뉴의 상태에서 스탯을 분배하고, 정체를 숨긴 채 탑에 오르기';
      this.ow.goto('room', [3, 4], 'D').then(() => { this.save(); next(); });
      return 'async';
    }
  }

  onCutsceneEnd() { this.save(); }

  // ---------- 상점 ----------
  icon(id) {
    const it = this.items[id] || {};
    const map = { ramen: '🍜', painkiller: '💊', first_aid: '🩹', potion: '🧪', return_stone: '🔮', mana_shard: '💎', dagger_old: '🗡️', cloth_work: '👕', jacket_hunter: '🧥', coat_armored: '🥋' };
    return map[id] || (it.slot === 'weapon' ? '⚔️' : it.slot === 'outfit' ? '🧥' : '📦');
  }
  itemInfo(it) { return it.atk ? `공격 +${it.atk}` : it.hp ? `체력 +${it.hp}` : it.heal ? `회복 ${it.heal}` : ''; }

  openShop(list, title) {
    this.menuOpen = true; this.input.reset();
    const s = this.state;
    let sel = list[0], msg = '';
    const render = () => {
      const it = this.items[sel];
      const grid = list.map((id) => `<button class="slot ${id === sel ? 'on' : ''}" data-s="${id}"><span class="ic">${this.icon(id)}</span><span class="nm">${esc(this.items[id].name)}</span><span class="ct">${won(this.items[id].price)}</span></button>`).join('');
      const shard = s.inv.mana_shard || 0;
      const sell = title === '헌터 상점' ? `<button data-sell="1" ${shard ? '' : 'disabled'}>마정석 조각 ${shard}개 팔기</button>` : '';
      this.ov.innerHTML = `<div class="screen"><div class="panel">
        <div class="ptop"><b>${esc(title)}</b><span>${won(s.money)}</span><button class="x" id="close">✕</button></div>
        <div class="pbody"><div class="grid">${grid}</div>
          <div class="detail"><div class="big">${this.icon(sel)}</div><b>${esc(it.name)}</b><p>${esc(this.itemInfo(it))}</p><p class="dim">${esc(it.desc || '')}</p><p class="dim">보유 ${s.inv[sel] || 0}</p>
          <button class="primary" id="buy" ${s.money < it.price ? 'disabled' : ''}>${won(it.price)}에 사기</button>${sell}<p class="dim">${esc(msg)}</p></div></div>
      </div></div>`;
      this.ov.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => { sel = b.dataset.s; msg = ''; render(); }));
      this.ov.querySelector('#buy').onclick = () => { if (s.money >= it.price) { s.money -= it.price; s.inv[sel] = (s.inv[sel] || 0) + 1; this.sound.sfx('select'); msg = it.name + ' 구입'; render(); } };
      const sb = this.ov.querySelector('[data-sell]'); if (sb) sb.onclick = () => { s.money += shard * this.items.mana_shard.sell; s.inv.mana_shard = 0; msg = '팔았어요'; render(); };
      this.ov.querySelector('#close').onclick = () => this.closeMenu();
    };
    render();
  }

  restoreButtons() { this.worldButtons(); }

  // ---------- 메뉴 (제노니아식 한 화면 탭) ----------
  openMenu(tab = 'bag') {
    if (this.talking || (this.mode === 'world' && this.ow.cut)) return;
    if (!['world', 'porter', 'field'].includes(this.mode)) return;
    this.menuOpen = true; this.input.reset();
    this.menuTab = tab; this.bagSel = this.bagSel || null; this.bagPage = this.bagPage || 0;
    this.renderMenu();
  }

  renderMenu(msg = '') {
    const s = this.state, tab = this.menuTab;
    const tabs = [['bag', '가방'], ['gear', '장비'], ['status', '상태'], ['map', '지도'], ['quest', '퀘스트'], ['settings', '설정']];
    let body = '';
    if (tab === 'bag') body = this.menuBag();
    if (tab === 'gear') body = this.menuGear();
    if (tab === 'status') body = this.menuStatus();
    if (tab === 'map') body = '<div class="mapwrap"><canvas id="cmap"></canvas></div>';
    if (tab === 'quest') body = this.menuQuest();
    if (tab === 'settings') body = this.menuSettings();
    this.ov.innerHTML = `<div class="screen"><div class="panel">
      <div class="ptop">${tabs.map(([k, n]) => `<button class="tab ${tab === k ? 'on' : ''}" data-t="${k}">${n}</button>`).join('')}
        ${this.mode === 'world' ? '<button class="tab" id="sv">저장</button>' : ''}<button class="x" id="close">✕</button></div>
      <div class="pbody">${body}</div>
      ${msg ? `<div class="pmsg">${esc(msg)}</div>` : ''}
    </div></div>`;
    this.ov.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { this.menuTab = b.dataset.t; this.sound.sfx('select'); this.renderMenu(); }));
    const sv = this.ov.querySelector('#sv'); if (sv) sv.onclick = () => { this.save(); this.renderMenu('저장했어요'); };
    this.ov.querySelector('#close').onclick = () => this.closeMenu();
    this.bindMenu(tab);
  }

  closeMenu() { this.menuOpen = false; this.restoreButtons(); }

  menuBag() {
    const s = this.state;
    const ids = Object.keys(s.inv).filter((id) => s.inv[id] > 0 && this.items[id]);
    const per = 12, pages = Math.max(1, Math.ceil(ids.length / per));
    this.bagPage = Math.min(this.bagPage, pages - 1);
    const pageIds = ids.slice(this.bagPage * per, this.bagPage * per + per);
    if (!this.bagSel || !ids.includes(this.bagSel)) this.bagSel = ids[0] || null;
    const slots = Array.from({ length: per }, (_, i) => {
      const id = pageIds[i];
      if (!id) return '<div class="slot empty"></div>';
      return `<button class="slot ${id === this.bagSel ? 'on' : ''}" data-b="${id}"><span class="ic">${this.icon(id)}</span><span class="nm">${esc(this.items[id].name)}</span><span class="ct">×${s.inv[id]}</span></button>`;
    }).join('');
    let det = '<p class="dim">비어 있어요.</p>';
    if (this.bagSel) {
      const it = this.items[this.bagSel], id = this.bagSel;
      let act = '';
      if (it.slot === 'use' && it.heal) act = `<button class="primary" data-use="${id}">사용</button>`;
      if ((it.slot === 'weapon' || it.slot === 'outfit')) act = this.awakened() ? (s.equip[it.slot] === id ? '<button disabled>장착 중</button>' : `<button class="primary" data-eq="${id}">장착</button>`) : '<p class="dim">짐꾼은 사무소 장비만 쓴다</p>';
      det = `<div class="big">${this.icon(id)}</div><b>${esc(it.name)} ×${s.inv[id]}</b><p>${esc(this.itemInfo(it))}</p><p class="dim">${esc(it.desc || '')}</p>${act}`;
    }
    const pager = pages > 1 ? `<div class="pager"><button data-pg="-1">◀</button><span>${this.bagPage + 1} / ${pages}</span><button data-pg="1">▶</button></div>` : '';
    return `<div class="left"><div class="grid g4">${slots}</div>${pager}</div><div class="detail"><p class="dim">${won(s.money)} · 체력 ${Math.round(s.hp)} / ${this.maxHp()}</p>${det}</div>`;
  }

  menuGear() {
    const s = this.state;
    if (!this.awakened()) return `<div class="detail wide"><b>짐꾼 장비</b><p>사무소에서 빌린 작업복과 짐 지게.</p><p class="dim">각성 전에는 장비를 바꿀 수 없다.</p></div>`;
    const slot = (k, n) => { const id = s.equip[k], it = this.items[id]; return `<div class="eq"><span class="ic">${it ? this.icon(id) : '·'}</span><div><small>${n}</small><b>${it ? esc(it.name) : '없음'}</b><small>${it ? esc(this.itemInfo(it)) : ''}</small></div></div>`; };
    const own = Object.keys(s.inv).filter((id) => s.inv[id] > 0 && this.items[id] && ['weapon', 'outfit'].includes(this.items[id].slot));
    const grid = own.map((id) => `<button class="slot ${s.equip[this.items[id].slot] === id ? 'on' : ''}" data-eq="${id}"><span class="ic">${this.icon(id)}</span><span class="nm">${esc(this.items[id].name)}</span><span class="ct">${esc(this.itemInfo(this.items[id]))}</span></button>`).join('');
    return `<div class="left">${slot('weapon', '무기')}${slot('outfit', '옷')}<p class="dim">공격력 +${this.equipStat('atk')} · 체력 +${this.equipStat('hp')}</p></div><div class="detail"><b>가진 장비</b><div class="grid g3">${grid}</div></div>`;
  }

  menuStatus() {
    const s = this.state, D = Math.max(0, DEADLINE - s.day);
    const left = `<div class="kv"><span>이름</span><b>${esc(fmt('{성이름}', s))}</b></div>
      <div class="kv"><span>신분</span><b>${this.awakened() ? esc(s.job) + ' · Lv.' + s.lv : '비각성자 · 짐꾼'}</b></div>
      <div class="kv"><span>체력</span><b>${Math.round(s.hp)} / ${this.maxHp()}</b></div>
      ${this.awakened() ? `<div class="kv"><span>경험치</span><b>${s.exp} / ${this.expNeed()}</b></div><div class="kv"><span>소문</span><b>${s.rumor.toFixed(1)}</b></div>` : `<div class="kv"><span>동행 최고층</span><b>${s.porterDepth}층</b></div>`}
      <div class="kv"><span>가진 돈</span><b>${won(s.money)}</b></div>
      <div class="kv"><span>31층 기한</span><b>D-${D}</b></div>`;
    let right;
    if (!this.awakened()) right = '<p class="dim">비각성자는 레벨과 경험치가 없다.</p><p class="dim">행동 하나하나가 어딘가에 기록되고 있다는 걸, 아직 아무도 모른다.</p>';
    else {
      const main = (this.jobs[s.job] || {}).main || [];
      right = `<p class="dim">남은 포인트 <b>${s.pts}</b> · 데미지 배율 ×${(new Player(this, 0, 0)).dmgMult().toFixed(2)}</p>` + Object.keys(STAT_NAMES).map((k) => `<div class="kv"><span>${STAT_NAMES[k]}${main.includes(k) ? ' <small>주</small>' : ''}</span><b>${s.stats[k]}</b><button data-k="${k}" ${s.pts ? '' : 'disabled'}>+</button></div>`).join('');
    }
    return `<div class="left">${left}</div><div class="detail">${right}</div>`;
  }

  menuQuest() {
    const s = this.state;
    const tips = this.awakened() ? ['정체를 숨긴 채 탑에 오르면 소문이 퍼진다', '주 스탯을 올리면 데미지가 강해진다', '달리면서 공격하면 돌진 베기'] : ['원정 중 마정석을 주우면 수당이 붙는다', '다친 파티원에게 구급상자를 건넬 수 있다', '자면 월세와 식비가 나간다'];
    return `<div class="left"><b>지금 할 일</b><p class="obj">▶ ${esc(s.objective || '자유롭게 둘러보기')}</p><p class="dim">${s.day + 1}일째 · 31층 기한 D-${Math.max(0, DEADLINE - s.day)}</p></div><div class="detail"><b>알아두기</b>${tips.map((t) => `<p class="dim">· ${esc(t)}</p>`).join('')}</div>`;
  }

  menuSettings() {
    const V = Settings.v;
    const seg = (key, opts) => `<div class="seg">${opts.map(([v, n]) => `<button data-set="${key}" data-v="${v}" class="${String(V[key]) === String(v) ? 'on' : ''}">${n}</button>`).join('')}</div>`;
    const row = (label, html) => `<div class="setrow"><span>${label}</span>${html}</div>`;
    return `<div class="left">${row('조이스틱', seg('joyMode', [['fixed', '고정'], ['float', '자유']]))}${row('조이스틱 크기', seg('joySize', [['s', '작게'], ['m', '보통'], ['l', '크게']]))}${row('민감도', seg('sens', [['s', '낮음'], ['m', '보통'], ['l', '높음']]))}${row('달리기 전환', seg('runAt', [['s', '빨리'], ['m', '보통'], ['l', '끝까지']]))}${row('밀어서 회피', seg('swipeDodge', [[true, '켬'], [false, '끔']]))}</div>
      <div class="detail">${row('버튼 크기', seg('btnSize', [['s', '작게'], ['m', '보통'], ['l', '크게']]))}${row('버튼 투명도', seg('btnAlpha', [['s', '흐리게'], ['m', '보통'], ['l', '진하게']]))}${row('왼손 모드', seg('lefty', [[false, '끔'], [true, '켬']]))}${row('화면 확대', seg('zoom', [['s', '가깝게'], ['m', '보통'], ['l', '멀게']]))}${row('소리', `<div class="seg"><button id="snd" class="${this.sound.enabled ? 'on' : ''}">${this.sound.enabled ? '켜짐' : '꺼짐'}</button><button id="tt">타이틀로</button></div>`)}</div>`;
  }

  bindMenu(tab) {
    const s = this.state;
    if (tab === 'bag') {
      this.ov.querySelectorAll('[data-b]').forEach((b) => (b.onclick = () => { this.bagSel = b.dataset.b; this.renderMenu(); }));
      this.ov.querySelectorAll('[data-pg]').forEach((b) => (b.onclick = () => { this.bagPage = Math.max(0, this.bagPage + Number(b.dataset.pg)); this.renderMenu(); }));
      const u = this.ov.querySelector('[data-use]'); if (u) u.onclick = () => { const id = u.dataset.use, it = this.items[id]; if (s.hp >= this.maxHp()) return this.renderMenu('체력이 가득하다'); s.inv[id]--; s.hp = Math.min(this.maxHp(), s.hp + it.heal); this.renderMenu(it.name + ' 사용'); };
    }
    this.ov.querySelectorAll('[data-eq]').forEach((b) => (b.onclick = () => { const it = this.items[b.dataset.eq]; s.equip[it.slot] = b.dataset.eq; s.hp = Math.min(s.hp, this.maxHp()); this.renderMenu(it.name + ' 장착'); }));
    this.ov.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => { if (s.pts > 0) { s.stats[b.dataset.k]++; s.pts--; if (b.dataset.k === 'vit') s.hp += 10; this.renderMenu(); } }));
    this.ov.querySelectorAll('[data-set]').forEach((b) => (b.onclick = () => { let v = b.dataset.v; if (v === 'true') v = true; if (v === 'false') v = false; Settings.v[b.dataset.set] = v; Settings.save(); this.view.applyZoom(); this.renderMenu(); }));
    const snd = this.ov.querySelector('#snd'); if (snd) snd.onclick = () => { this.sound.toggle(); this.renderMenu(); };
    const tt = this.ov.querySelector('#tt'); if (tt) tt.onclick = () => { this.save(); this.menuOpen = false; this.showTitle(); };
    if (tab === 'map') this.drawCityMap();
  }

  drawCityMap() {
    const cv = this.ov.querySelector('#cmap'); if (!cv) return;
    const wrap = cv.parentElement, W = wrap.clientWidth, H = wrap.clientHeight, D = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = W * D; cv.height = H * D; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const x = cv.getContext('2d'); x.scale(D, D);
    const s = this.state, cm = this.citymap, cur = this.ow.map ? this.ow.map.id : null;
    const nodeOf = (id) => cm.nodes.find((n) => n.id === id || (n.inside || []).includes(id));
    const here = this.mode === 'world' ? nodeOf(cur) : cm.nodes.find((n) => n.id === 'plaza');
    const cols = 5, rows = 2, bw = Math.min(150, (W - 40) / cols - 14), bh = Math.min(64, (H - 70) / rows - 20);
    const pos = (n) => [20 + n.x * ((W - 40) / cols) + ((W - 40) / cols - bw) / 2, 30 + n.y * ((H - 60) / rows) + ((H - 60) / rows - bh) / 2];
    x.fillStyle = '#1a2a3a'; x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(58,120,184,0.5)'; x.fillRect(0, 0, W, 18 + bh * 0.4);
    x.strokeStyle = '#8a8f96'; x.lineWidth = 6;
    for (const [a, b] of cm.links) { const A = pos(cm.nodes.find((n) => n.id === a)), B = pos(cm.nodes.find((n) => n.id === b)); x.beginPath(); x.moveTo(A[0] + bw / 2, A[1] + bh / 2); x.lineTo(B[0] + bw / 2, B[1] + bh / 2); x.stroke(); }
    for (const n of cm.nodes) {
      const [px, py] = pos(n), seen = s.visited && s.visited[n.id];
      x.fillStyle = seen ? (n.id === 'plaza' ? '#4a3a6a' : '#3a4a3a') : '#2a2a2a'; x.fillRect(px, py, bw, bh);
      x.strokeStyle = here === n ? '#ffd23f' : '#c9a24a'; x.lineWidth = here === n ? 3 : 1.5; x.strokeRect(px, py, bw, bh);
      x.fillStyle = seen ? '#f3e3b5' : '#777'; x.font = '700 13px system-ui'; x.textAlign = 'center';
      x.fillText(seen ? n.name : '???', px + bw / 2, py + bh / 2 + 4);
      if (here === n) { x.fillStyle = '#ff4a4a'; x.beginPath(); x.arc(px + bw / 2, py - 8, 6, 0, Math.PI * 2); x.fill(); x.font = '600 11px system-ui'; x.fillStyle = '#ffd23f'; x.fillText('현재 위치', px + bw / 2, py + bh + 14); }
      if (n.id === 'plaza') { x.fillStyle = '#b48cff'; x.fillRect(px + bw / 2 - 6, py - 26, 12, 22); }
    }
    x.textAlign = 'left'; x.fillStyle = '#c9a24a'; x.font = '600 12px system-ui'; x.fillText('한성특별시', 10, H - 10);
  }

  // ---------- 짐꾼 원정 ----------
  startExpedition() {
    const s = this.state;
    const n = Math.min(10, s.porterDepth + 1);
    this.dayShards = 0; this.floorsToday = 0;
    if (n >= 10) { this.startRift(); return; }
    this.startPorterFloor(n);
  }

  startPorterFloor(n) {
    const f = this.floors[n - 1];
    this.fx = new FX(this.A, this.view);
    this.porter = new PorterRun(this, f, () => this.porterGoal());
    this.mode = 'porter';
    this.view.cam.x = this.porter.me.x; this.view.cam.y = this.porter.me.y;
    this.sound.play('field');
    this.worldButtons();
    this.toast(`${f.name} · 들꽃 파티 동행`);
    if (n === 1 && !this.state.flags.porterTip) { this.state.flags.porterTip = true; this.runLines([
      { speaker: this.npcName('taesung'), portrait: this.portraitKey('taesung'), text: '짐 들고 뒤에만 붙어 있어. 싸움은 우리가 한다.' },
      { text: '[조작] 떨어진 마정석 근처에서 오른쪽을 탭하면 줍기. 오른쪽을 밀면 회피. 다친 파티원 위에 !가 뜨면 다가가서 구급상자를 건넬 수 있다.' }]); }
  }

  porterGoal() {
    const s = this.state, n = this.porter.floor.n;
    s.porterDepth = Math.max(s.porterDepth, n);
    this.dayShards += this.porter.shards;
    this.floorsToday++;
    const lead = { speaker: this.npcName('taesung'), portrait: this.portraitKey('taesung') };
    if (this.floorsToday < 2 && n < 9) {
      this.runLine({ ...lead, text: `${n}층 정리 끝. 한 층 더 갈까?`, choices: [{ text: '다음 층으로', flag: '_next' }, { text: '오늘은 여기까지 하죠' }] }, () => {
        if (s.flags._next) { delete s.flags._next; this.startPorterFloor(n + 1); } else this.endExpedition();
      });
    } else {
      this.runLine({ ...lead, text: n >= 9 ? '9층까지 왔다. 내일은 10층 보스방 앞까지 간다. 일당 두 배.' : '오늘은 여기까지. 수고했다.' }, () => this.endExpedition());
    }
  }

  endExpedition() {
    const s = this.state;
    const pay = WAGE + this.dayShards * SHARD_BONUS;
    s.money += pay;
    s.flags.jobToday = false; s.flags.workedToday = true;
    s.objective = '원룸에 돌아가 쉬기';
    this.porter = null;
    this.enterWorldMode();
    this.ow.load('plaza', [7, 4], 'D').then(() => {
      this.runLine({ text: `일당 ${won(WAGE)}에 회수 수당 ${won(this.dayShards * SHARD_BONUS)}. 가진 돈 ${won(s.money)}.` }, () => this.save());
    });
  }

  onPorterDeath() {
    this.state.dead = true; Save.wipe(); this.sound.stopMusic(); this.sound.sfx('death');
    setTimeout(() => this.showEnd(), 2200);
  }

  startRift() {
    this.porter = null;
    this.enterWorldMode();
    this.ow.load('rift', [4, 4], 'U').then(() => this.ow.play('rift'));
  }

  // ---------- 각성 후 탑 전투 ----------
  openFloorSelect() {
    this.menuOpen = true; this.input.reset();
    const s = this.state;
    let cells = '';
    for (let i = 1; i <= this.floors.length; i++) {
      const open = i <= s.unlocked;
      cells += `<button class="slot floor ${s.cleared[i] ? 'on' : ''}" data-f="${i}" ${open ? '' : 'disabled'}><span class="ic">${open ? (s.cleared[i] ? '✔' : '▲') : '🔒'}</span><span class="nm">${i}층</span></button>`;
    }
    this.ov.innerHTML = `<div class="screen"><div class="panel"><div class="ptop"><b>탑 · 정체 은닉</b><span>목표를 채우면 보스가 나타난다</span><button class="x" id="close">✕</button></div>
      <div class="pbody"><div class="grid g5 full">${cells}</div></div></div></div>`;
    this.ov.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { this.menuOpen = false; this.enterFloor(Number(b.dataset.f)); }));
    this.ov.querySelector('#close').onclick = () => this.closeMenu();
  }

  enterFloor(n) {
    const s = this.state, f = this.floors[n - 1];
    this.floor = f; this.kills = 0; this.boss = null; this.floorDone = false;
    const map = Object.assign({}, this.mapTemplate, { seed: f.seed });
    this.world = new World(this.A, map);
    this.fx = new FX(this.A, this.view);
    this.player = new Player(this, this.world.spawn.x, this.world.spawn.y);
    this.enemies = new Enemies(this, this.monsters, f);
    this.view.cam.x = this.player.x; this.view.cam.y = this.player.y;
    this.mode = 'field';
    this.sound.play('field');
    this.fieldButtons();
    if (!s.flags.fieldTip) { s.flags.fieldTip = true; this.hud.hintT = 8; }
  }

  fieldButtons() { this.worldButtons(); }

  healItem() {
    const s = this.state;
    const order = this.mode === 'field' ? ['potion', 'painkiller', 'ramen'] : ['painkiller', 'ramen', 'potion'];
    return order.find((id) => (s.inv[id] || 0) > 0);
  }

  quickHeal() {
    const s = this.state, id = this.healItem();
    if (!id) { this.toast('회복 아이템이 없다'); return; }
    if (s.hp >= this.maxHp()) { this.toast('체력이 가득하다'); return; }
    s.inv[id]--; s.hp = Math.min(this.maxHp(), s.hp + this.items[id].heal);
    const who = this.mode === 'field' ? this.player : this.mode === 'porter' ? this.porter.me : this.ow.actors.player;
    if (who && this.fx) this.fx.num(who.x, who.y - 120, '+' + this.items[id].heal, 'exp');
    this.sound.sfx('select');
  }

  layoutButtons() {
    const v = this.view, W = v.W, H = v.H, k = Settings.btnK(), L = Settings.v.lefty;
    const X = (x) => (L ? x : W - x);
    const B = [];
    const s = this.state;
    if (this.mode === 'world' && !this.ow.cut) {
      const lab = this.ow.prompt ? this.ow.prompt.label : '조사';
      B.push({ id: 'act', x: X(78 * k), y: H - 74 * k, r: 40 * k, label: lab.length > 4 ? lab.slice(0, 4) : lab });
    } else if (this.mode === 'porter' && this.porter) {
      const lab = this.porter.prompt ? (this.porter.prompt.kind === 'drop' ? '줍기' : '건네기') : '줍기';
      B.push({ id: 'act', x: X(78 * k), y: H - 74 * k, r: 40 * k, label: lab });
      B.push({ id: 'dodge', x: X(162 * k), y: H - 46 * k, r: 28 * k, label: '회피' });
      const hid = this.healItem(); B.push({ id: 'potion', x: X(150 * k), y: H - 128 * k, r: 22 * k, label: hid ? this.items[hid].name.slice(0, 3) : '없음', sub: hid ? s.inv[hid] : 0 });
    } else if (this.mode === 'field' && this.world) {
      B.push({ id: 'act', x: X(78 * k), y: H - 74 * k, r: 42 * k, label: '공격' });
      B.push({ id: 'dodge', x: X(166 * k), y: H - 44 * k, r: 28 * k, label: '회피' });
      B.push({ id: 'skill1', x: X(70 * k), y: H - 168 * k, r: 26 * k, label: '기술', cost: 25 });
      const hid = this.healItem(); B.push({ id: 'potion', x: X(150 * k), y: H - 132 * k, r: 22 * k, label: hid ? this.items[hid].name.slice(0, 3) : '없음', sub: hid ? s.inv[hid] : 0 });
    }
    this.input.buttons = this.talking || this.menuOpen ? [] : B;
  }

  goalText() {
    if (this.mode === 'porter') return `파티 처치 ${this.porter.kills} / ${this.porter.goal} · 회수 ${this.porter.shards}`;
    const f = this.floor; if (!f) return '';
    if (this.floorDone) return '목표 완료';
    if (this.boss) return '보스를 쓰러뜨리세요';
    return `목표 처치 ${this.kills} / ${f.goal}`;
  }

  onKill(e) {
    const s = this.state;
    s.kills++; this.kills++;
    s.sp = Math.min(60, s.sp + 4);
    s.exp += e.d.exp;
    this.fx.num(e.x, e.y - 100, '+' + e.d.exp + ' EXP', 'exp');
    if (e.d.money) s.money += Math.round(e.d.money[0] + Math.random() * (e.d.money[1] - e.d.money[0]));
    if (e.d.drop) for (const id in e.d.drop) if (Math.random() < e.d.drop[id]) s.inv[id] = (s.inv[id] || 0) + 1;
    s.rumor += 0.02;
    while (s.lv < 100 && s.exp >= this.expNeed()) {
      s.exp -= this.expNeed(); s.lv++; s.pts += 5; s.hp = this.maxHp();
      this.hud.say('레벨 업! Lv.' + s.lv + ' · 스탯 포인트 +5'); this.sound.sfx('levelup');
    }
    if (e === this.boss) { this.clearFloor(); return; }
    if (!this.floorDone && !this.boss && this.kills >= this.floor.goal) { this.boss = this.enemies.spawnBoss(this.floor.boss); this.hud.say('강한 기운이 다가온다'); this.sound.play('boss'); }
  }

  clearFloor() {
    const s = this.state, n = this.floor.n;
    this.floorDone = true; this.sound.play('hub');
    if (!s.cleared[n]) s.rumor += 1;
    s.cleared[n] = true; s.unlocked = Math.max(s.unlocked, n + 1);
    this.save();
    setTimeout(() => {
      if (this.mode !== 'field') return;
      this.menuOpen = true;
      const next = n + 1 <= this.floors.length;
      this.ov.innerHTML = `<div class="screen"><div class="card small"><h2>${esc(this.floor.name)} 돌파</h2><p class="hint">가진 돈 ${won(s.money)} · 소문 ${s.rumor.toFixed(1)}</p>
        <div class="row"><button id="home" style="flex:1">광장으로</button>${next ? '<button id="next" style="flex:1">다음 층으로</button>' : ''}</div></div></div>`;
      this.ov.querySelector('#home').onclick = () => { this.menuOpen = false; this.backToPlaza(); };
      if (next) this.ov.querySelector('#next').onclick = () => { this.menuOpen = false; this.enterFloor(n + 1); };
    }, 1500);
  }

  backToPlaza() {
    this.world = null; this.player = null; this.floor = null; this.boss = null;
    this.enterWorldMode();
    this.ow.load('plaza', [7, 3], 'D').then(() => this.save());
  }

  onPlayerDeath() { this.state.dead = true; Save.wipe(); this.sound.stopMusic(); this.sound.sfx('death'); setTimeout(() => this.showEnd(), 2600); }

  showEnd() {
    this.mode = 'end'; this.menuOpen = true;
    const s = this.state;
    this.ov.innerHTML = `<div class="screen"><div class="card end">
      <h2>${esc(s.given)}의 이야기는 여기서 끝났습니다</h2>
      <p class="hint">${this.awakened() ? esc(s.job) + ' · Lv.' + s.lv : '비각성자 · 짐꾼'} · 31층 기한 D-${Math.max(0, DEADLINE - s.day)}</p>
      <p class="hint">하드코어 게임이라 이 기록은 사라졌어요.</p>
      <button class="primary" id="tt">처음으로</button>
    </div></div>`;
    this.ov.querySelector('#tt').onclick = () => { this.menuOpen = false; this.showTitle(); };
  }

  // ---------- 매 프레임 ----------
  update(dt) {
    this.view.update(dt);
    this.hud.update(dt);
    this.input.update(dt);
    this.zoomForMode();
    this.layoutButtons();
    const busy = this.talking || this.menuOpen;
    this.input.mode = this.talking ? 'dialogue' : (this.menuOpen || (this.mode === 'world' && this.ow.cut)) ? 'menu' : (['world', 'porter', 'field'].includes(this.mode) ? 'field' : 'menu');
    if (this.talking) this.dialogue.update(dt);
    const btn = this.ov.querySelector('#menuBtn'); if (btn) btn.style.display = this.talking || this.ow.cut ? 'none' : '';
    if (this.mode === 'world') { this.ow.update(busy ? 0 : dt); if (busy && this.ow.cut) this.ow.cut.update(0); }
    else if (this.mode === 'porter' && this.porter) {
      if (!busy && !this.porter.dead) this.porter.update(dt);
      this.fx.update(busy ? 0 : dt);
      const w = this.porter.world;
      this.view.follow(this.porter.me.x, this.porter.me.y, dt, { w: w.w, h: w.h });
    } else if (this.mode === 'field' && this.world) {
      if (busy) return;
      if (this.hitstop > 0) { this.hitstop -= dt; for (const f of this.fx.list) f.t += dt * 0.3; return; }
      this.comboT = Math.max(0, this.comboT - dt); if (this.comboT <= 0) this.comboN = 0;
      this.player.update(dt); this.enemies.update(dt); this.fx.update(dt);
      this.view.follow(this.player.x, this.player.y, dt, { w: this.world.w, h: this.world.h });
      const s = this.state; s.sp = Math.min(60, s.sp + dt * 0.5);
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
    if (this.mode === 'world') {
      this.ow.draw();
      if (this.fx) { this.fx.draw(false); this.fx.drawNums(); }
      v.screen();
      this.ow.drawOverlay();
      if (!this.ow.cut || this.talking) { this.hud.drawWorld(); if (!this.talking) this.ow.drawMinimap(v.W - 12, 52, 150, 64); }
      this.hud.drawControls();
    } else if (this.mode === 'porter' && this.porter) {
      this.porter.draw();
      v.screen();
      this.hud.drawPorter();
      this.hud.drawControls();
    } else if (this.mode === 'field' && this.world) {
      v.world();
      this.world.drawGround(v);
      this.fx.draw(true);
      const list = [];
      this.world.collectProps(v, list); this.enemies.collect(list); this.player.collect(list);
      list.sort((a, b) => a.y - b.y).forEach((o) => o.d());
      this.fx.draw(false); this.player.drawSwords(); this.fx.drawNums();
      v.screen();
      this.hud.draw();
      this.hud.drawControls();
    } else {
      const g = ctx.createRadialGradient(v.W / 2, v.H / 2, 40, v.W / 2, v.H / 2, Math.max(v.W, v.H) * 0.7);
      g.addColorStop(0, '#2a2018'); g.addColorStop(1, '#0d0a08');
      ctx.fillStyle = g; ctx.fillRect(0, 0, v.W, v.H);
    }
    if (this.talking) this.hud.drawDialogue(this.dialogue);
  }
}

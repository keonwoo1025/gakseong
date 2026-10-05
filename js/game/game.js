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
import { setSkin } from './hud.js';
import { charKey } from './people.js';
import { Settings } from '../engine/settings.js';
import { Skills } from './skills.js';
import { Gear } from './gear.js';
import { MazeWorld } from './maze.js';
import { Allies } from './allies.js';
import { Events, checkCond } from './events.js';
import { Quests } from './quests.js';
import { TS } from './overworld.js';

const PATTERN_JOB = { 공격: '천마', 수호: '대지의 군주', 관찰: '폭풍의 사수', 탐구: '공간의 절대자', 구조: '성휘의 사도', 은밀: '명왕' };
const STAT_NAMES = { str: 'STR', dex: 'DEX', int: 'INT', vit: 'VIT' };
const STAT_DESC = { str: '물리 공격력', dex: '공격속도·명중·회피', int: '마법 공격력·MP', vit: 'HP·방어' };
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
    this.sk = new Skills(this);
    this.gear = new Gear(this);
    this.events = new Events(this); this.quests = new Quests(this); this.camZoom = 1; this.zoomK = 1;
    this.fx = null;
    this.talking = false;
    this.portraits = {};
    this.input.on('button', (id) => {
      if (id === 'skip') { if (this.ow.cut) this.ow.cut.skip(); return; }
      if (this.talking || this.menuOpen || (this.mode === 'world' && this.ow.cut)) return;
      if (id === 'skip') { if (this.ow.cut) this.ow.cut.skip(); return; }
      if (id === 'menu') return this.openMenu('status');
      if (id === 'map') return this.openMenu('map');
      if (id === 'quest') return this.openMenu('quest');
      const fight = (this.mode === 'field' || this.mode === 'world') && this.player;
      if (id === 'pk' && this.mode === 'world') { Settings.v.pk = !Settings.v.pk; Settings.save(); this.toast(Settings.v.pk ? 'PK 켜짐 · 사람도 공격한다' : 'PK 꺼짐'); return; }
      if (id === 'act') {
        if (this.mode === 'porter') this.porter.interact();
        else if (this.mode === 'world' && this.actTarget()) this.ow.interact();
        else if (this.mode === 'field' && this.pickTarget()) this.pickDrop(this.pickTarget());
        else if (fight) this.player.attack();
      }
      if (id === 'dodge') { if (this.mode === 'porter') this.porter.dodge(0, 0); else if (fight) this.player.dodge(0, 0); }
      const m = /^skill(\d)$/.exec(id); if (m && fight && this.awakened()) this.player.skill(this.slotIdx(Number(m[1]) - 1));
      if (id === 'potion') this.quickHeal();
    });
    this.input.on('dodge', (dx, dy) => {
      if (this.talking || this.menuOpen) return;
      if (this.mode === 'porter') this.porter.dodge(dx, dy);
      else if ((this.mode === 'field' || (this.mode === 'world' && !this.ow.cut)) && this.player) this.player.dodge(dx, dy);
    });
    this.input.on('tap', (x, y) => { if (this.talking) this.dialogue.tap(x, y); });
  }

  async getJSON(u) { return (await fetch(u + '?v=' + (this.ver || Date.now()), { cache: 'no-cache' })).json(); }

  async boot() {
    this.A = await loadAssets('data/manifest.json', (d, t) => (this.progress = [d, t]));
    this.ver = this.A.version + '.' + Date.now().toString(36).slice(-3);
    const names = ['jobs', 'monsters', 'npcs', 'items', 'shop', 'store', 'floors', 'barks', 'news', 'music', 'looks', 'citymap', 'skills', 'combos', 'personality', 'folk', 'gear', 'objects', 'events', 'quests', 'affinity'];
    const data = await Promise.all(names.map((n) => this.getJSON(`data/${n}.json`)));
    const as = { folk: 'folkDef', gear: 'gearDef', events: 'eventList', quests: 'questDef', affinity: 'affDef' };
    names.forEach((n, i) => (this[as[n] || n] = data[i]));
    this.mapTemplate = await this.getJSON('data/maps/floor01.json');
    this.npcById = Object.fromEntries(this.npcs.map((n) => [n.id, n]));
    this.sound.setTracks(this.music);
    setSkin((n) => this.A.ui && this.A.ui[n]);
    this.applyArt();
    this.genFloors();
    this.applyCssSkin();
    this.showTitle();
  }

  // ---------- 공통 ----------
  check(c, ctx) { return checkCond(this, c, ctx); }
  fmt(t) { return fmt(t, this.state || {}); }
  pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  // ---------- 친밀도·말투 ----------
  aff(id, n) {
    const s = this.state, before = this.affStage(id);
    s.aff[id] = Math.max(0, Math.min(100, (s.aff[id] || 0) + n));
    const after = this.affStage(id);
    if (after !== before && n > 0) this.toast(`${this.npcName(id)} · ${after}`);
  }
  affStage(id) { const v = (this.state.aff || {})[id] || 0; let name = ''; for (const [m, nm] of this.affDef.stages) if (v >= m) name = nm; return name; }
  npcPers(id) { const f = this.folkOf(id); return f ? f.personality : (this.state.npcs[id] || {}).personality; }
  npcAxes(id) { const f = this.folkOf(id); return (f && f.axes) || (this.state.npcs[id] || {}).axes || (this.personality[this.npcPers(id)] || {}).axes || [0, 0, 0, 0, 0]; }
  // 0 존댓말, 1 반말: 원래 반말인 성격이거나, 친구 이상이 되고 질서 성향이 낮으면 반말로 바뀐다
  speech(id) { const P = this.personality[this.npcPers(id)] || {}; if (P.speech === 'ban') return 1; return (this.state.aff[id] || 0) >= 50 && this.npcAxes(id)[4] < 40 ? 1 : 0; }
  // 하루 한 번 말 걸면 친밀도가 오른다. 선한 성향은 악업이 높으면 오히려 멀어진다
  dailyTalk(id) {
    const s = this.state; if (s.talked[id] === s.day) return;
    s.talked[id] = s.day;
    if ((s.karma || 0) >= 20 && this.npcAxes(id)[0] >= 30) this.aff(id, -1); else this.aff(id, 2);
  }
  timeName() { return ['아침', '낮', '저녁', '밤'][(this.state && this.state.time) || 0]; }
  passTime(n = 1) { const s = this.state; s.time = Math.min(3, (s.time || 0) + n); }
  newDay() { const s = this.state; s.time = 0; s.infamy = Math.max(0, (s.infamy || 0) - 0.5); this.quests.checkDeadline(); }

  // 선물: 하루 한 번, 성격별로 좋아하는 종류가 다르다
  giveGift(itemId) {
    const s = this.state, pr = this.ow.prompt; if (!pr || pr.kind !== 'npc') return '선물할 사람 옆에서 쓸 수 있다';
    const id = pr.a.npc.id, it = this.items[itemId];
    if (pr.a.mood && pr.a.mood !== 'calm') return '지금은 받을 상황이 아니다';
    if ((s.gifted = s.gifted || {})[id] === s.day) return '오늘은 이미 선물했다';
    s.gifted[id] = s.day; s.inv[itemId]--;
    const P = this.personality[this.npcPers(id)] || {}, ax = this.npcAxes(id);
    const kind = (P.likes || []).includes(it.cat) ? 'like' : ax[3] > 50 && ['sweet', 'flower'].includes(it.cat) ? 'dislike' : 'meh';
    this.aff(id, { like: 8, meh: 3, dislike: -2 }[kind]);
    this.closeMenu();
    this.runLine({ speaker: this.npcName(id), portrait: this.portraitKey(id), text: this.pick(this.affDef.lines[kind][this.speech(id)]) });
    return null;
  }
  toast(t) { this.hud.say(t, 2.6); }
  sysNote(t) { this.hud.say(t, 3); this.sound.sfx('select'); }
  countItem(id) { return this.gear.isGear(id) ? this.gear.count(id) : (this.state.inv[id] || 0); }
  // 아이템을 얻었을 때: 퀘스트 진행·아이템 트리거
  // 탑 바이옴별 그림 조합 (assets/atlas/tower2)
  biomeOf(name = '') {
    if (/동굴/.test(name)) return { floor: ['c_rock', 'c_crys', 'c_vein'], wall: 'w_ctop', cliff: 'w_ccliff', stairs: 'stairs', wallProps: ['crys_b', 'stalag', 'boulder', 'crys_b'], deco: ['spikes', 'bones', 'shroom_g', 'mossrock'] };
    if (/평원/.test(name)) return { floor: ['p_gold', 'f_dirt'], wall: 'w_thorn', cliff: 'w_dcliff', stairs: 'stairs', wallProps: ['tree_dead', 'standing', 'signpost'], deco: ['tuft', 'log', 'nest', 'campfire', 'mossrock'] };
    if (/고목/.test(name)) return { floor: ['o_leaves', 'o_roots'], wall: 'w_roots', cliff: 'w_dcliff', stairs: 'stairs', wallProps: ['tree_dead2', 'mushroom_big', 'pine_mist'], deco: ['shroom_g', 'log', 'tuft', 'nest'] };
    if (/유적/.test(name)) return { floor: ['r_slab', 'r_crack', 'r_moss', 'r_rune'], wall: 'w_rtop', cliff: 'w_rface', stairs: 'r_stairs', wallProps: ['col', 'col_broken', 'obelisk', 'torch', 'torch_b'], deco: ['runestone', 'bones', 'oldsword', 'barrel', 'supply'] };
    return { floor: ['f_clover', 'f_cobble', 'f_dirt'], wall: 'w_canopy', cliff: 'w_fcliff', stairs: 'stairs', wallProps: ['pine_mist', 'tree_dead2', 'standing', 'pine_mist'], deco: ['tuft', 'mossrock', 'log', 'shroom_g', 'bones'] };
  }

  // ---------- 바닥 아이템 ----------
  pickTarget() {
    const p = this.player; if (!p || ((!this.drops || !this.drops.length) && !(this.world && this.world.maze))) return null; this.drops = this.drops || [];
    if (this.enemies && this.enemies.list.some((e) => e.alive && Math.hypot(e.x - p.x, e.y - p.y) < 220)) return null;
    let best = null, bd = 100;
    for (const d of this.drops) { const k = Math.hypot(d.x - p.x, d.y - p.y); if (k < bd) { bd = k; best = d; } }
    for (const o of (this.world && this.world.ores) || []) { const k = Math.hypot(o.x - p.x, o.y - p.y); if (!o.mined && k < 130 && k < bd + 30) { bd = k; best = o; } }
    for (const c of (this.world && this.world.chests) || []) { const k = Math.hypot(c.x - p.x, c.y - p.y); if (!c.opened && k < 120 && k < bd + 20) { bd = k; best = c; } }
    return best;
  }
  pickDrop(d) {
    if (d.ore) {   // 마정석 채굴
      d.mined = true; this.sound.sfx('heavy'); this.view.addShake(4);
      const n = d.k === 'ore_bl' ? 3 : d.k === 'ore_r' ? 4 : 2;
      for (let i = 0; i < n; i++) this.drops.push({ id: 'mana_shard', x: d.x + (i - n / 2) * 36, y: d.y + 30, t: 0 });
      this.hud.say('마정석을 캤다', 1.8); return;
    }
    if (d.chest) {   // 보물 상자: 소모품 2~3개 + 장비 한 번 굴림
      d.opened = true; this.sound.sfx('levelup');
      const pool = ['potion', 'mana_potion', 'potion_atk', 'potion_def', 'potion_spd', 'mana_shard', 'mana_shard'];
      const n = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) this.drops.push({ id: pool[Math.floor(Math.random() * pool.length)], x: d.x + (i - 1) * 50, y: d.y + 40, t: 0 });
      const gd = this.gear.rollDrop({ d: { variant: 'elite' } }); if (gd) this.drops.push({ id: gd, x: d.x, y: d.y + 70, t: 0 });
      this.hud.say('보물 상자를 열었다', 2); return;
    }
    const s = this.state, it = this.items[d.id];
    if (this.gear.isGear(d.id)) this.gear.give(d.id); else s.inv[d.id] = (s.inv[d.id] || 0) + 1;
    this.drops = this.drops.filter((x) => x !== d);
    this.onItem(d.id); this.sound.sfx('select');
    this.hud.say(`${it.rarity && it.rarity !== '일반' ? '[' + it.rarity + '] ' : ''}${it.name} 획득`, 2.2);
  }
  drawDrop(d) {
    const v = this.view, ctx = v.ctx, it = this.items[d.id] || {}, col = this.gear.color(it.rarity), T = performance.now() / 1000;
    const y = d.y - 18 + Math.sin(T * 3 + d.x) * 4;
    if (it.rarity && it.rarity !== '일반') { const gr = ctx.createLinearGradient(0, d.y - 140, 0, d.y); gr.addColorStop(0, col + '00'); gr.addColorStop(1, col + '99'); ctx.fillStyle = gr; ctx.fillRect(d.x - 8, d.y - 140, 16, 140); }
    v.shadow(d.x, d.y, 16);
    const ic = this.A.ui && this.A.ui['item_' + d.id];
    if (ic && ic.w && !ic.missing) ctx.drawImage(ic.im, d.x - 22, y - 22, 44, 44);
    else { ctx.font = '30px system-ui'; ctx.textAlign = 'center'; ctx.fillText(this.icon(d.id), d.x, y + 10); }
    ctx.font = '700 20px system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.strokeText(it.name || '', d.x, y - 28); ctx.fillStyle = col; ctx.fillText(it.name || '', d.x, y - 28); ctx.textAlign = 'left';
  }

  // ---------- 소모품·버프 ----------
  buffK(k) { const b = this.state && this.state.buffs && this.state.buffs[k]; return b && b.t > 0 ? (k === 'def' ? 1 - b.k : 1 + b.k) : 1; }
  useItem(id) {
    const s = this.state, it = this.items[id]; if (!it || !(s.inv[id] > 0)) return '없다';
    if (id === 'return_stone') { if (this.mode !== 'field' || this.eventFightCb) return '탑 안에서만 쓸 수 있다'; s.inv[id]--; this.closeMenu(); this.drops = []; this.backToPlaza(); return null; }
    if (it.buff) { s.buffs = s.buffs || {}; s.buffs[it.buff] = { k: it.k, t: it.t }; }
    else if (it.cure) { if (this.enemies) {} s.debuffs = {}; }
    else if (it.heal || it.mp) { if ((!it.heal || s.hp >= this.maxHp()) && (!it.mp || (s.mp || 0) >= this.maxMp())) return '이미 가득하다'; if (it.heal) s.hp = Math.min(this.maxHp(), s.hp + it.heal); if (it.mp) s.mp = Math.min(this.maxMp(), (s.mp || 0) + it.mp); }
    else return '쓸 수 없는 물건이다';
    s.inv[id]--;
    const who = this.mode === 'porter' ? this.porter && this.porter.me : this.player;
    if (who && this.fx) this.fx.num(who.x, who.y - 120, it.heal ? '+' + Math.min(it.heal, 999) : it.name, 'exp');
    this.sound.sfx('select');
    return null;
  }

  onItem(id) { this.quests.sync(); this.events.fire('item', { item: id }); }
  onMapLoaded(m) { if (!this.state) return; if (this.state.flags.introDone && !this.ow.cut) setTimeout(() => this.save(), 300); this.quests.on('go', { map: m.id }); setTimeout(() => this.events.fire('enter', { map: m.id }), 50); }
  gainExp(n) {
    const s = this.state; s.exp += n;
    while (s.lv < 100 && s.exp >= this.expNeed()) {
      s.exp -= this.expNeed(); s.lv++; s.pts += 5; s.skp = (s.skp || 0) + 1; s.hp = this.maxHp();
      this.hud.say('레벨 업! Lv.' + s.lv + ' · 스탯 포인트 +5'); this.sound.sfx('levelup');
    }
  }
  recordPattern(k, amt) { this.state.pattern[k] = (this.state.pattern[k] || 0) + amt; }
  combo() { this.comboN++; this.comboT = 1.6; }
  equipStat(k) { return this.gear.stat(k); }
  expNeed() { return Math.floor(50 * Math.pow(this.state.lv, 1.8)); }
  // ---- 능력치 (STR·DEX·INT·VIT) ----
  st(k) { return (this.state.stats && this.state.stats[k]) || 5; }
  maxHp() { const s = this.state; return 100 + this.st('vit') * 12 + (s.lv - 1) * 6 + this.equipStat('hp'); }
  maxMp() { const s = this.state; return 40 + this.st('int') * 5 + (s.lv - 1) * 2; }
  atkPower() {
    const job = this.jobs[this.state.job] || {}, k = job.dmgStat || 'str';
    const base = this.awakened() ? 12 : 8;
    return Math.round((base + this.equipStat('atk') + this.st(k) * 2) * (job.dmgBase || 1) * (1 + this.sk.P('atk')));
  }
  aspd() { return (1 + (this.st('dex') - 5) * 0.006) * (1 + this.sk.P('aspd')); }
  moveMult() { return (1 + (this.st('dex') - 5) * 0.002) * (1 + this.sk.P('move') + this.gear.stat('move')) * this.buffK('spd'); }
  playerEva() { return Math.min(0.45, (this.st('dex') - 5) * 0.004 + 0.03 + this.sk.P('eva') + this.gear.stat('eva')); }
  dmgTaken() { const d = this.gear.stat('def') * 1; if (!this.state) return 1; const bk = this.buffK('def'); return Math.max(0.3, (1 - (this.st('vit') - 5) * 0.006) * (1 - this.sk.P('dr')) * 100 / (100 + d) * bk); }
  rollHit(e) { const acc = (this.st('dex') - 5) * 0.003; return Math.random() >= Math.max(0, (e.d.eva || 0) - acc); }
  migrateStats(s) {
    const o = s.stats || {};
    if ('agi' in o || 'spi' in o) s.stats = { str: o.str || 5, dex: o.agi || 5, int: Math.max(o.int || 5, o.spi || 5), vit: o.vit || 5 };
    if (s.mp === undefined) s.mp = 40;
  }
  parry(e) {
    if (e.parried && performance.now() / 1000 - e.parried < 0.3) return;
    e.parried = performance.now() / 1000;
    const p = this.player;
    e.hitDone = true; e.st = 'rec'; e.stt = -0.6; e.stun = 1.1;
    const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
    e.kx += dx / d * 420; e.ky += dy / d * 420;
    this.fx.sfx('imp', (e.x + p.x) / 2, (e.y + p.y) / 2 - 50, { s: 2.2, fps: 18 });
    this.fx.sfx('ring', (e.x + p.x) / 2, (e.y + p.y) / 2, { s: 3, fps: 18, ground: true });
    this.fx.num((e.x + p.x) / 2, (e.y + p.y) / 2 - 110, 'PARRY', 'parry');
    this.sound.sfx('parry'); this.hitstop = 0.14; this.view.addShake(6); this.flashParry = 0.18;
    this.recordPattern('관찰', 0.5);
  }
  awakened() { return this.state.phase !== 'porter'; }

  folkOf(id) { return this.state && this.state.folk && this.state.folk.find((f) => f.uid === id); }
  npcName(id) { const n = this.npcById[id]; if (!n) { const f = this.folkOf(id); return f ? f.name : id; } return this.state && this.state.gender === 'f' && n.nameIfFemalePlayer ? n.nameIfFemalePlayer : n.name; }
  lookOf(id) {
    if (id === 'player') return this.playerLook();
    if (id === 'seoyun') return this.looks[this.state && this.state.gender === 'f' ? 'seoyun_m' : 'seoyun_f'];
    const f = this.folkOf(id); if (f) return f.look;
    return this.looks[id] || { top: '#777', bottom: '#444' };
  }
  playerLook() { return this.looks[this.state && this.state.gender === 'f' ? 'player_f' : 'player_m']; }
  speakerName(id) { if (id === 'player') return this.state.given; if (this.npcById[id] || this.folkOf(id)) return this.npcName(id); return id; }
  portraitKey(id, override) {
    if (override) return override; if (id === 'player' || this.npcById[id] || this.looks[id]) return 'gen:' + id;
    // 일반 행인: 남녀별 임시 초상화 3개를 돌려 쓴다 (port2 에 npc_m1~3, npc_f1~3 그림이 오면 자동 교체)
    const f = this.folkOf(id); if (f) { let h = 0; for (const c of f.uid) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 'gen:npc_' + f.gender + (1 + (h % 3)); }
    return null;
  }
  portraitOf(key, emo) {
    if (!key) return null;
    if (key.startsWith('gen:') && this.A.port2) {
      const P2 = this.A.port2[charKey(this, key.slice(4))];
      if (P2 && P2[emo || 0] && !P2[emo || 0].missing) { const o = P2[emo || 0]; o.big = true; return o; }
    }
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
    if (this.mode === 'world' && this.ow.map && this.ow.actors.player) { s.map = this.ow.map.id; s.pos = [Math.floor(this.ow.actors.player.x / TS), Math.floor((this.ow.actors.player.y - 15) / TS)]; s.resume = null; }
    // 탑 안에서 저장하면 이어할 때 그 층 처음부터 (전투 중간 상태는 저장하지 않음)
    else if (this.mode === 'field' && this.floor && !this.eventFightCb) s.resume = { mode: 'field', floor: this.floor.n };
    else if (this.mode === 'porter' && this.porter) s.resume = { mode: 'porter', floor: this.porter.floor.n };
    Save.write(s);
  }

  // ---------- 타이틀과 생성 ----------
  showTitle() {
    this.mode = 'title'; this.ow.map = null; this.world = null; document.body.className = 'plain';
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
      const PERS = Object.keys(this.personality);
      for (const n of this.npcs) { const pe = PERS.includes(n.fixed) ? n.fixed : this.pick(PERS); s.npcs[n.id] = { personality: pe, axes: this.personality[pe].axes.map((v) => Math.max(-100, Math.min(100, v + Math.round((Math.random() - 0.5) * 40)))) }; }
      this.gear.give('dagger_old'); s.equip.outfit = this.gear.give('cloth_work');
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
    this.migrateStats(st); this.player = null;
    this.enterWorldMode();
    if (!st.flags.introDone) { this.ow.play('prologue'); return; }
    const gone = { street: 'alley' };
    if (gone[st.map]) { st.map = gone[st.map]; st.pos = null; }
    const rs = st.resume;
    this.ow.load(st.map || 'room', st.pos || null).then(() => {
      if (rs && rs.mode === 'field' && this.floors[rs.floor - 1]) this.enterFloor(rs.floor);
      else if (rs && rs.mode === 'porter' && this.floors[rs.floor - 1]) { this.expFloors = []; this.startPorterFloor(rs.floor); }
    });
  }

  enterWorldMode() {
    this.mode = 'world'; this.porter = null; this.floor = null; this.boss = null;
    this.fx = new FX(this.A, this.view);
    this.player = null; this.townPlayer();
    this.worldButtons();
  }

  // 마을에서도 탑과 같은 주인공·공격 판정을 쓴다. 충돌은 마을 지도, 공격 대상은 마을 사람(PK 허용 시).
  townPlayer() {
    if (this.player && this.player.town) return this.player;
    const ow = this.ow;
    this.world = {
      get w() { return ow.W; }, get h() { return ow.H; },
      solid: (x, y) => ow.solidAt(x, y, null), moveBody: (o, dx, dy) => ow.move(o, dx, dy), unstick: (o) => ow.unstick(o),
      randomSpot: (avoid) => ow.folk.randomFloor(avoid) || [ow.W / 2, ow.H / 2],
    };
    this.enemies = ow.folk;
    const p = new Player(this, 0, 0);
    p.town = true; p.look = this.playerLook(); p.fr = { big: false }; p.speed = 390;
    this.player = p;
    this.sk.reset(); if (this.awakened()) this.sk.ensure();
    return p;
  }

  worldButtons() { this.ov.innerHTML = ''; this.applyTheme(); }

  zoomForMode() { const t = this.mode === 'world' && this.ow.cut ? this.camZoom || 1 : 1; this.zoomK += (t - this.zoomK) * 0.08; this.view.setZoom(96, 1.12 / this.zoomK); }   // 마을·원정·탑 모두 같은 크기 기준

  // ---------- 말 걸기와 조사 ----------
  talkTo(npc, actor) {
    const s = this.state, id = npc.id;
    this.quests.on('talk', { npc: id });
    if (this.events.fire('talk', { npc: id })) return;
    if (this.quests.talk(id)) return;
    if (npc.talk === 'line') { this.runLine({ speaker: this.npcName(id), portrait: this.portraitKey(id), text: this.fmt(npc.text) }); return; }
    if (npc.talk === 'bark') {
      const lines = this.barks[s.npcs[id] ? s.npcs[id].personality : ''] || ['…'];
      this.dailyTalk(id);
      this.runLine({ speaker: this.npcName(id), portrait: this.portraitKey(id), text: this.pick(lines) });
      return;
    }
    if (npc.talk === 'stranger') {
      const P = this.personality[this.npcPers(id)] || {}, known = (s.aff[id] || 0) >= 20 && P.lines.known;
      this.dailyTalk(id);
      this.runLine({ speaker: this.npcName(id), portrait: this.portraitKey(id), text: this.pick(known ? P.lines.known[this.speech(id)] : (P.lines && P.lines.stranger) || ['…']) });
      return;
    }
    if ((npc.talk === 'store' || npc.talk === 'shop') && (s.infamy || 0) >= this.folkDef.guard.refuse) { this.runLine({ speaker: this.npcName(id), portrait: this.portraitKey(id), text: '…당신한텐 안 팔아요. 나가 주세요.' }); return; }
    if (npc.talk === 'line') this.dailyTalk(id);
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
    const last = s.porterDepth >= 9;
    this.runLine({ speaker: n, portrait: k, text: last ? '들꽃 파티가 10층 보스방 앞까지 간단다. 일당 두 배. 갈래?' : '들꽃 파티 동행 건 있다. 일당 4만 원에 회수 수당 따로. 할래?', choices: [{ text: '하겠습니다', flag: '_job' }, { text: '오늘은 쉴게요' }] }, () => {
      if (s.flags._job) { delete s.flags._job; s.flags.jobToday = true; this.gather(); }
    });
  }

  useObject(o) {
    const s = this.state;
    if (o.id && this.events.fire('examine', { obj: o.id })) return;
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
      s.day++; s.money -= LIVING_COST; s.hp = this.maxHp(); this.newDay();
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
      s.objTarget = { map: 'office', at: [2, 2] };
      this.save();
      return;
    }
    if (name === 'awaken') {
      const ranked = Object.entries(s.pattern).sort((a, b) => b[1] - a[1]);
      s.job = PATTERN_JOB[ranked[0][0]];
      this.ow.play('awaken');
      return 'async';
    }
    if (name === 'systemOn') {
      this.sysPopup([
        { h: '알림', t: '조건을 충족했습니다.' },
        { h: '알림', t: '전설 「{직업}」의 계승이 확인되었습니다.' },
        { h: '시스템', t: '지금부터 이 창은 당신에게만 보입니다.' },
      ], next);
      return 'async';
    }
    if (name === 'grantLegend' || (name === 'afterAwaken' && s.phase === 'porter')) {
      s.phase = 'hidden'; s.flags.masked = true;
      s.lv = 1; s.exp = 0; s.pts = 5;
      s.stats = { str: 5, dex: 5, int: 5, vit: 5 };
      s.unlocked = 1; s.cleared = {};
      s.sk = { p: [1, 0, 0, 0, 0], a: [1, 0, 0, 0] }; s.skp = 0;
      if (!s.equip.weapon) { const w = this.gear.owned().find((u) => this.gear.item(u).slot === 'weapon'); if (w) s.equip.weapon = w; }
      this.player = null; if (this.mode === 'world') { const p0 = this.ow.actors.player; const np = this.townPlayer(); if (p0) { np.x = p0.x; np.y = p0.y; np.dir = p0.dir; this.ow.actors.player = np; } }
      s.hp = this.maxHp(); s.mp = this.maxMp();
      if (name === 'grantLegend') return;
    }
    if (name === 'afterAwaken') {
      s.hp = this.maxHp(); s.mp = this.maxMp();
      s.flags.jobToday = false; s.flags.workedToday = true;
      s.objective = '상태 창에서 스탯을 분배하고, 탑 광장에서 정체를 숨긴 채 탑에 오르기';
      s.objTarget = { map: 'plaza', at: [16, 2] };
      this.quests.start('main_31');
      // 각성 후: 10층까지는 이미 뚫린 상태, 11층부터 오른다
      s.cleared = s.cleared || {}; for (let i = 1; i <= 10; i++) s.cleared[i] = true; s.unlocked = Math.max(s.unlocked || 1, 11); s.porterDepth = 10;
      this.ow.goto('room', [3, 4], 'D').then(() => { this.save(); next(); });
      return 'async';
    }
  }

  onCutsceneEnd() { this.save(); }

  // ---------- 상점 ----------
  icon(id) {
    const sk = this.A.ui && this.A.ui['item_' + id];
    if (sk && sk.im) { this.iconCache = this.iconCache || {}; if (!this.iconCache[id]) this.iconCache[id] = sk.im.toDataURL(); return `<img class="uiimg" src="${this.iconCache[id]}" alt="">`; }
    const it = this.items[id] || {};
    const map = { ramen: '🍜', painkiller: '💊', first_aid: '🩹', potion: '🧪', return_stone: '🔮', mana_shard: '💎', cloth_work: '👕', jacket_hunter: '🧥', coat_armored: '🥋' };
    const W = { sword: '⚔️', blade: '🔪', spear: '🔱', bow: '🏹', staff: '🪄', dagger: '🗡️', gauntlet: '🥊' }, S = { outfit: '🧥', mask: '🎭', shoes: '👟', ring: '💍', neck: '📿' };
    return map[id] || (it.slot === 'weapon' ? W[it.type] || '⚔️' : S[it.slot] || '📦');
  }
  // 장비 수치 (강화 반영)
  itemInfo(it, plus = 0) {
    const k = 1 + this.gearDef.enhance.perLevel * plus, o = [];
    if (it.atk) o.push(`공격 +${Math.round(it.atk * k)}`);
    if (it.hp) o.push(`체력 +${Math.round(it.hp * k)}`);
    if (it.def) o.push(`방어 +${Math.round(it.def * k)}`);
    if (it.eva) o.push(`회피 +${Math.round(it.eva * 100)}%`);
    if (it.move) o.push(`이동 +${Math.round(it.move * 100)}%`);
    if (it.atkPct) o.push(`피해 +${Math.round(it.atkPct * 100)}%`);
    if (it.heal) o.push(`회복 ${it.heal}`);
    return o.join(' · ');
  }
  rStyle(r) { return r && r !== '일반' ? `border-color:${this.gear.color(r)};` : ''; }
  rClass(r) { return r === '전설' || r === '신화' ? 'rglow' : ''; }
  rname(it, plus) { return `<b style="color:${this.gear.color(it.rarity)}">${esc(it.name)}${plus ? ' +' + plus : ''}</b>`; }

  openShop(list, title) {
    this.menuOpen = true; this.input.reset();
    const s = this.state;
    let sel = list[0], msg = '', page = 0;
    const per = 8, pages = Math.ceil(list.length / per);
    const render = () => {
      const it = this.items[sel];
      const pageIds = list.slice(page * per, page * per + per);
      const pager = pages > 1 ? `<div class="pager"><button data-pg="-1">◀</button><span>${page + 1} / ${pages}</span><button data-pg="1">▶</button></div>` : '';
      const gear = this.gear.isGear(sel), have = gear ? this.gear.count(sel) : s.inv[sel] || 0;
      const grid = pageIds.map((id) => `<button class="slot ${id === sel ? 'on' : ''} ${this.rClass(this.items[id].rarity)}" data-s="${id}" style="${this.rStyle(this.items[id].rarity)}"><span class="ic">${this.icon(id)}</span><span class="nm">${esc(this.items[id].name)}</span><span class="ct">${won(this.items[id].price)}</span></button>`).join('');
      const shard = s.inv.mana_shard || 0;
      const sell = title === '헌터 상점' ? `<button data-sell="1" ${shard ? '' : 'disabled'}>마정석 조각 ${shard}개 팔기</button>` : '';
      this.ov.innerHTML = `<div class="screen"><div class="panel">
        <div class="ptop"><b>${esc(title)}</b><span>${won(s.money)}</span><button class="x" id="close">✕</button></div>
        <div class="pbody"><div class="left"><div class="grid">${grid}</div>${pager}</div>
          <div class="detail"><div class="big">${this.icon(sel)}</div>${this.rname(it)}<p class="dim">${esc(it.rarity || '')}${it.type ? ' · ' + esc(this.gearDef.types[it.type].name) : ''}</p><p>${esc(this.itemInfo(it))}</p><p class="dim">${esc(it.desc || '')}</p><p class="dim">보유 ${have}</p>
          <button class="primary" id="buy" ${s.money < it.price ? 'disabled' : ''}>${won(it.price)}에 사기</button>${sell}<p class="dim">${esc(msg)}</p></div></div>
      </div></div>`;
      this.ov.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => { sel = b.dataset.s; msg = ''; render(); }));
      this.ov.querySelector('#buy').onclick = () => { if (s.money >= it.price) { s.money -= it.price; if (gear) this.gear.give(sel); else s.inv[sel] = (s.inv[sel] || 0) + 1; this.onItem(sel); this.sound.sfx('select'); msg = it.name + ' 구입'; render(); } };
      this.ov.querySelectorAll('[data-pg]').forEach((b) => (b.onclick = () => { page = (page + Number(b.dataset.pg) + pages) % pages; render(); }));
      const sb = this.ov.querySelector('[data-sell]'); if (sb) sb.onclick = () => { s.money += shard * this.items.mana_shard.sell; s.inv.mana_shard = 0; msg = '팔았어요'; render(); };
      this.ov.querySelector('#close').onclick = () => this.closeMenu();
    };
    render();
  }

  restoreButtons() { this.worldButtons(); }
  slotIdx(i) { const m = this.state && this.state.slotMap; return m && m[i] != null ? m[i] : i; }

  // 공격 버튼이 말 걸기·조사가 되는 경우: PK 끔이면 대상이 있을 때, PK 켬이면 근처에 사람이 없을 때 조사·줍기만
  actTarget() {
    const pr = this.ow.prompt; if (!pr || this.ow.cut) return null;
    if (!Settings.v.pk) return pr;
    if (pr.kind === 'npc') return null;
    const p = this.player, near = p && this.enemies && this.enemies.list.some((e) => Math.hypot(e.x - p.x, e.y - p.y) < 200);
    return near ? null : pr;
  }

  // ---------- 메뉴 (제노니아식 한 화면 탭) ----------
  openMenu(tab = 'status') {
    if (this.talking || (this.mode === 'world' && this.ow.cut)) return;
    if (!['world', 'porter', 'field'].includes(this.mode)) return;
    this.menuOpen = true; this.input.reset();
    // 버튼을 누른 손가락이 떼어질 때 생기는 클릭이 창의 다른 탭을 누르지 않게 잠깐 막는다
    this.ov.style.pointerEvents = 'none'; clearTimeout(this.ovT); this.ovT = setTimeout(() => (this.ov.style.pointerEvents = ''), 400);
    this.menuTab = tab; this.bagSel = this.bagSel || null; this.bagPage = this.bagPage || 0;
    this.renderMenu();
  }

  renderMenu(msg = '') {
    const s = this.state, tab = this.menuTab;
    const tabs = [['status', '상태'], ['gear', '장비'], ['bag', '가방'], ['skill', '스킬'], ['quest', '퀘스트'], ['map', '지도'], ['settings', '시스템']];
    let body = '';
    if (tab === 'bag') body = this.menuBag();
    if (tab === 'gear') body = this.menuGear();
    if (tab === 'status') body = this.menuStatus();
    if (tab === 'map') body = '<div class="mapwrap"><canvas id="cmap"></canvas></div>';
    if (tab === 'quest') body = this.menuQuest();
    if (tab === 'skill') body = this.menuSkill();
    if (tab === 'settings') body = this.menuSettings();
    this.ov.innerHTML = `<div class="screen"><div class="panel">
      <div class="ptop">${tabs.map(([k, n]) => `<button class="tab ${tab === k ? 'on' : ''}" data-t="${k}">${n}</button>`).join('')}
<button class="x" id="close">✕</button></div>
      <div class="pbody">${body}</div>
      ${msg ? `<div class="pmsg">${esc(msg)}</div>` : ''}
    </div></div>`;
    this.ov.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { this.menuTab = b.dataset.t; this.sound.sfx('select'); this.renderMenu(); }));
    const sv = this.ov.querySelector('#sv'); if (sv) sv.onclick = () => { this.save(); this.renderMenu('저장했어요'); };
    this.ov.querySelector('#close').onclick = () => this.closeMenu();
    this.bindMenu(tab);
  }

  closeMenu() { this.menuOpen = false; this.pend = {}; this.skPend = {}; this.restoreButtons(); }

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
      return `<button class="slot ${id === this.bagSel ? 'on' : ''} ${this.rClass(this.items[id].rarity)}" data-b="${id}" style="${this.rStyle(this.items[id].rarity)}"><span class="ic">${this.icon(id)}</span><span class="nm">${esc(this.items[id].name)}</span><span class="ct">×${s.inv[id]}</span></button>`;
    }).join('');
    let det = '<p class="dim">비어 있어요.</p>';
    if (this.bagSel) {
      const it = this.items[this.bagSel], id = this.bagSel;
      let act = '';
      if (it.slot === 'use') act = `<button class="primary" data-use="${id}">사용</button>` + (id !== 'return_stone' ? `<button data-quick="${id}" ${s.quickItem === id ? 'disabled' : ''}>${s.quickItem === id ? '빠른 사용 중' : '빠른 사용 지정'}</button>` : '');
      if (it.cat && this.mode === 'world' && this.ow.prompt && this.ow.prompt.kind === 'npc') act += `<button data-gift="${id}">${esc(this.npcName(this.ow.prompt.a.npc.id))}에게 선물</button>`;
      det = `<div class="big">${this.icon(id)}</div><b>${esc(it.name)} ×${s.inv[id]}</b><p>${esc(this.itemInfo(it))}</p><p class="dim">${esc(it.desc || '')}</p>${act}`;
    }
    const pager = pages > 1 ? `<div class="pager"><button data-pg="-1">◀</button><span>${this.bagPage + 1} / ${pages}</span><button data-pg="1">▶</button></div>` : '';
    return `<div class="left"><div class="grid g4">${slots}</div>${pager}</div><div class="detail"><p class="dim">${won(s.money)} · 체력 ${Math.round(s.hp)} / ${this.maxHp()}</p>${det}</div>`;
  }

  // 장비: 왼쪽 위 착용 부위 6칸, 아래 가진 장비(쪽 넘김), 오른쪽 선택한 장비 설명과 장착·강화
  menuGear() {
    const s = this.state, G = this.gear, D = this.gearDef;
    const RO = Object.keys(D.rarity), own = G.owned().sort((a, b) => RO.indexOf(G.item(b).rarity) - RO.indexOf(G.item(a).rarity) || a.localeCompare(b, 'en', { numeric: true }));
    const per = 8, pages = Math.max(1, Math.ceil(own.length / per));
    this.gearPage = Math.min(this.gearPage || 0, pages - 1);
    if (!this.gearSel || !s.gear[this.gearSel]) this.gearSel = s.equip.weapon || own[0] || null;
    const eqs = D.slots.map(([k, n]) => {
      const u = s.equip[k], it = u && G.item(u), lock = !G.canEquip(k);
      return `<button class="eqc ${u && u === this.gearSel ? 'on' : ''}" ${u ? `data-g="${u}"` : 'disabled'}><span class="ic">${it ? this.icon(it.id) : lock ? '🔒' : '·'}</span><span><small>${n}</small>${it ? `<i style="color:${G.color(it.rarity)}">${esc(it.name)}${it.plus ? ' +' + it.plus : ''}</i>` : `<i class="dim">${lock ? '각성 후' : '없음'}</i>`}</span></button>`;
    }).join('');
    const pageIds = own.slice(this.gearPage * per, this.gearPage * per + per);
    const cells = Array.from({ length: per }, (_, i) => {
      const u = pageIds[i]; if (!u) return '<div class="slot empty"></div>';
      const it = G.item(u), on = Object.values(s.equip).includes(u);
      return `<button class="slot ${u === this.gearSel ? 'on' : ''}" data-g="${u}" class="${this.rClass(it.rarity)}" style="${this.rStyle(it.rarity)}"><span class="ic">${this.icon(it.id)}</span><span class="nm">${esc(it.name)}</span><span class="ct">${it.plus ? '+' + it.plus + ' ' : ''}${on ? '착용' : ''}</span></button>`;
    }).join('');
    const pager = pages > 1 ? `<div class="pager"><button data-gp="-1">◀</button><span>${this.gearPage + 1} / ${pages}</span><button data-gp="1">▶</button></div>` : '';
    const wt = G.weaponType(), ms = G.mastery(wt), mName = D.types[wt].name;
    const sum = `<p class="dim">공격 +${G.stat('atk')} · 체력 +${G.stat('hp')} · 방어 +${G.stat('def')} · ${esc(mName)} 숙련 ${ms.lv}단계${ms.lv < D.mastery.max ? ` (${Math.floor(ms.xp)}/${G.masteryNeed(ms.lv)})` : ''}</p>`;
    let det = '<p class="dim">가진 장비가 없다.</p>';
    const it = this.gearSel && G.item(this.gearSel);
    if (it) {
      const on = s.equip[it.slot] === it.uid, can = G.canEquip(it.slot);
      const eqB = !can ? '<p class="dim">각성 전에는 옷만 바꿀 수 있다</p>' : on ? `<button data-uneq="${it.slot}">해제</button>` : `<button class="primary" data-equ="${it.uid}">장착</button>`;
      let enh = '';
      if (['weapon', 'outfit'].includes(it.slot) || it.atk || it.hp || it.def) {
        if (!this.awakened()) enh = '<p class="dim">강화는 각성 후</p>';
        else if (it.plus >= D.enhance.max) enh = '<p class="dim">최대 강화</p>';
        else { const c = G.enhanceCost(it), rate = Math.round(D.enhance.rate[it.plus] * 100); enh = `<button data-enh="${it.uid}" ${this.mode === 'world' ? '' : 'disabled'}>강화 +${it.plus + 1} · ${rate}%</button><p class="dim">${won(c.money)} · 마정석 조각 ${c.shard} (보유 ${s.inv.mana_shard || 0})${it.plus >= D.enhance.safeUntil ? ' · 실패 시 하락' : ''}${this.mode === 'world' ? '' : ' · 마을에서만'}</p>`; }
      }
      det = `<div class="big">${this.icon(it.id)}</div>${this.rname(it, it.plus)}<p class="dim">${esc(it.rarity)} · ${esc(it.type ? D.types[it.type].name : (D.slots.find(([k]) => k === it.slot) || [, ''])[1])} · ${esc(this.itemInfo(it, it.plus))}</p>${(it.type && D.effects[it.type]) || it.opt ? `<p class="dim">${it.type && D.effects[it.type] ? esc(D.effects[it.type]) : ''}${it.opt ? ` · <b style="color:${G.color(it.rarity)}">${esc(it.opt.name)}</b>` : ''}</p>` : ''}<div class="strow">${eqB}</div>${enh}`;
    }
    return `<div class="left"><div class="eqs">${eqs}</div>${sum}<div class="grid">${cells}</div>${pager}</div><div class="detail">${det}</div>`;
  }

  menuStatus() {
    const s = this.state, D = Math.max(0, DEADLINE - s.day);
    const pend = this.pend || (this.pend = {});
    const used = Object.values(pend).reduce((a, b) => a + b, 0);
    const hpK = Math.min(1, s.hp / this.maxHp()), xpK = this.awakened() ? Math.min(1, s.exp / this.expNeed()) : 0;
    const left = `<div class="stleft"><canvas id="stp" width="34" height="34"></canvas>
      <b>${esc(fmt('{성이름}', s))}</b><span class="dim">${this.awakened() ? esc(s.job) + ' · LV.' + s.lv : '비각성자 · 짐꾼'}</span>
      <div class="bar hp"><i style="width:${hpK * 100}%"></i></div><span class="dim">체력 ${Math.round(s.hp)} / ${this.maxHp()}</span>
      ${this.awakened() ? `<div class="bar sp"><i style="width:${Math.min(1, s.mp / this.maxMp()) * 100}%"></i></div><span class="dim">MP ${Math.round(s.mp)} / ${this.maxMp()}</span><div class="bar xp"><i style="width:${xpK * 100}%"></i></div><span class="dim">경험치 ${s.exp} / ${this.expNeed()}</span>` : ''}
      <span class="dim">${won(s.money)} · 31층 D-${D}</span></div>`;
    if (!this.awakened()) {
      return `<div class="stwrap">${left}<div class="stright"><div class="big3"><div>동행 최고층<b>${s.porterDepth}층</b></div><div>일한 날<b>${s.day + 1}</b></div><div>회수 수당<b>${SHARD_BONUS}</b></div></div>
        <p class="dim">비각성자는 레벨과 경험치가 없다.</p><p class="dim">행동 하나하나가 어딘가에 기록되고 있다는 걸, 아직 아무도 모른다.</p></div></div>`;
    }
    const main = (this.jobs[s.job] || {}).main || [];
    const att = this.atkPower(), def = Math.round((1 - this.dmgTaken()) * 100);
    const stats = Object.keys(STAT_NAMES).map((k) => `<div>${STAT_NAMES[k]}${main.includes(k) ? '★' : ''}<b class="${pend[k] ? 'up' : ''}">${s.stats[k] + (pend[k] || 0)}</b><small>${STAT_DESC[k]}</small><button data-k="${k}" ${s.pts - used > 0 ? '' : 'disabled'}>+</button></div>`).join('');
    return `<div class="stwrap">${left}<div class="stright">
      <div class="big3"><div>공격력<b>${att}</b></div><div>피해 감소<b>${def}%</b></div><div>회피율<b>${Math.round(this.playerEva() * 100)}%</b></div></div>
      <div class="stats5">${stats}</div>
      <div class="strow"><span style="flex:1">남은 포인트 <b>${s.pts - used}</b> · ★ 주 스탯 · 소문 ${s.rumor.toFixed(1)}</span><button id="preset" ${used ? '' : 'disabled'}>되돌리기</button><button class="primary" id="apply" ${used ? '' : 'disabled'}>적용</button></div>
    </div></div>`;
  }

  menuSkill() {
    const s = this.state;
    const J = this.awakened() ? this.skills[s.job] : null;
    if (!J) return '<div class="detail"><b>스킬</b><p class="dim">아직 아무 기술도 없다.</p><p class="dim">각성자들은 저마다의 기술을 가진다. 비각성자에게는 해당되지 않는 이야기다.</p></div><div class="skgrid">' + Array.from({ length: 10 }, () => '<div class="slot empty"></div>').join('') + '</div>';
    this.sk.ensure();
    const pend = this.skPend || (this.skPend = {});
    const used = Object.values(pend).reduce((a, b) => a + b, 0);
    const cur = (k) => (k[0] === 'a' ? s.sk.a : s.sk.p)[Number(k.slice(1))] + (pend[k] || 0);
    const items = [{ k: 'd', name: J.dodge.name, type: '전용 회피', desc: J.dodge.desc, max: 1, fixed: true }]
      .concat(J.active.map((a, i) => ({ k: 'a' + i, name: a.name, type: i === 3 ? '궁극' : '액티브', desc: a.desc, req: a.req, max: a.max })))
      .concat(J.passive.map((a, i) => ({ k: 'p' + i, name: a.name, type: '패시브', desc: a.desc, req: this.sk.passiveReq(i), max: a.max })));
    if (!this.skillSel || !items.find((x) => x.k === this.skillSel)) this.skillSel = 'a0';
    const cells = items.map((x) => {
      const L = x.fixed ? 1 : cur(x.k);
      return `<button class="slot ${x.k === this.skillSel ? 'on' : ''}" data-sk="${x.k}"><small>${esc(x.type)}</small><span class="ic">${L ? '✦' : '🔒'}</span><span class="nm">${esc(x.name)}</span><small>${x.fixed ? '기본' : 'Lv ' + L + '/' + x.max}</small></button>`;
    }).join('');
    const x = items.find((i) => i.k === this.skillSel);
    const L = x.fixed ? 1 : cur(x.k);
    // 선행 스킬: 같은 줄의 앞 단계를 1 이상 배워야 한다
    const pre = (k) => { const n = Number(k.slice(1)); return n === 0 || cur(k[0] + (n - 1)) > 0; };
    const preOk = x.fixed || pre(x.k);
    const can = !x.fixed && preOk && s.skp - used > 0 && L < x.max && s.lv >= (x.req || 1);
    const why = x.fixed ? '회피 버튼에 연결됨' : !preOk ? '앞 단계 스킬을 먼저 배워야 한다' : s.lv < (x.req || 1) ? `LV.${x.req}부터 배울 수 있다` : L >= x.max ? '최대 레벨' : '';
    // 버튼 칸 배치 (배운 액티브만)
    const map = s.slotMap || [0, 1, 2, 3];
    const slotRow = x.k[0] === 'a' && L > 0 ? `<div class="strow"><span class="dim">버튼 칸</span>${[0, 1, 2, 3].map((i) => `<button data-slot="${i}" class="${map[i] === Number(x.k.slice(1)) ? 'on' : ''}">${i + 1}</button>`).join('')}</div>` : '';
    const node = (it) => { const l = it.fixed ? 1 : cur(it.k), ok = it.fixed || pre(it.k); return `<button class="sknode ${it.k === this.skillSel ? 'on' : ''} ${l ? 'got' : ok ? '' : 'lock'}" data-sk="${it.k}"><span>${esc(it.name)}</span><small>${it.fixed ? '회피' : (it.req ? 'LV' + it.req + ' · ' : '') + l + '/' + it.max}</small></button>`; };
    const col = (arr) => arr.map(node).join('<i class="skline"></i>');
    const tree = `<div class="sktree"><div class="skcol"><small class="dim">액티브</small>${col(items.filter((i) => i.k[0] === 'a'))}<small class="dim">회피</small>${node(items[0])}</div><div class="skcol"><small class="dim">패시브</small>${col(items.filter((i) => i.k[0] === 'p'))}</div></div>`;
    const grow = x.k[0] === 'a' ? '레벨마다 피해 +8%, 재사용 -2%' : x.k[0] === 'p' ? '레벨마다 효과 +15%' : '';
    return `<div class="detail"><b>${esc(x.name)}</b><p class="dim">${esc(x.type)}${x.req ? ' · 습득 LV.' + x.req : ''} · Lv ${L}/${x.max}</p><p>${esc(x.desc)}</p><p class="dim">${esc(grow)}</p>
      <div class="strow"><span style="flex:1">스킬 포인트 <b>${s.skp - used}</b>${why ? ' · ' + esc(why) : ''}</span><button data-skup="${x.k}" ${can ? '' : 'disabled'}>+</button></div>
      ${slotRow}<div class="strow"><button id="skreset" ${used ? '' : 'disabled'}>되돌리기</button><button class="primary" id="skapply" ${used ? '' : 'disabled'}>적용</button></div></div>${tree}`;
  }

  // 퀘스트 창: 각성 후부터. 왼쪽 목록(메인이 위), 오른쪽 상세와 추적
  menuQuest() {
    const s = this.state, Q = this.quests, D = this.questDef;
    if (!this.awakened()) return this.menuPorterQuest();
    const ids = Object.keys(s.quests || {}).filter((id) => D[id]).sort((a, b) => (D[a].type === 'main' ? 0 : 1) - (D[b].type === 'main' ? 0 : 1) || (s.quests[a].st === 'active' ? 0 : 1) - (s.quests[b].st === 'active' ? 0 : 1));
    if (!this.questSel || !ids.includes(this.questSel)) this.questSel = s.track || ids[0];
    const per = 6, pages = Math.max(1, Math.ceil(ids.length / per));
    this.questPage = Math.min(this.questPage || 0, pages - 1);
    const st = { active: '진행 중', done: '완료', failed: '실패' };
    const rows = ids.slice(this.questPage * per, this.questPage * per + per).map((id) => `<button class="qrow ${id === this.questSel ? 'on' : ''}" data-q="${id}"><small>${D[id].type === 'main' ? '메인' : '서브'}${s.track === id ? ' · 추적' : ''}</small><b>${esc(D[id].title)}</b><i>${st[s.quests[id].st]}${Q.ready(id) ? ' · 보고 가능' : ''}</i></button>`).join('');
    const pager = pages > 1 ? `<div class="pager"><button data-qp="-1">◀</button><span>${this.questPage + 1} / ${pages}</span><button data-qp="1">▶</button></div>` : '';
    let det = '<p class="dim">진행 중인 퀘스트가 없다.</p>';
    const id = this.questSel;
    if (id) {
      const d = D[id], q = s.quests[id], stg = d.stages[Math.min(q.stage, d.stages.length - 1)];
      const goals = q.st === 'active' ? stg.goals.map((G, k) => { const [a, b] = Q.goal(id, k); return `<p class="${a >= b ? 'dim' : ''}">▸ ${esc(this.questGoalText(G))} ${b > 1 ? a + ' / ' + b : a >= b ? '✔' : ''}</p>`; }).join('') : '';
      const R = d.reward || {}, rw = [R.money ? won(R.money) : '', R.exp ? `경험치 ${R.exp}` : '', ...Object.keys(R.items || {}).map((k) => `${this.items[k].name} ×${R.items[k]}`)].filter(Boolean).join(' · ');
      det = `<b>${esc(d.title)}</b><p class="dim">${d.type === 'main' ? '메인' : '서브'}${d.giver ? ' · ' + esc(this.npcName(d.giver)) : ''}${d.deadline ? ' · 기한 D-' + Math.max(0, d.deadline - s.day) : ''}</p><p>${esc(d.desc || '')}</p>${q.st === 'active' ? `<p class="obj">▶ ${esc(Q.ready(id) && d.giver ? this.npcName(d.giver) + '에게 보고' : stg.text)}</p>` : ''}${goals}${rw ? `<p class="dim">보상 ${esc(rw)}</p>` : ''}${q.st === 'active' ? `<div class="strow"><button class="primary" data-track="${id}" ${s.track === id ? 'disabled' : ''}>${s.track === id ? '추적 중' : '추적하기'}</button></div>` : ''}`;
    }
    return `<div class="left">${rows || '<p class="dim">받은 퀘스트가 없다.</p>'}${pager}</div><div class="detail">${det}</div>`;
  }

  questGoalText(G) {
    if (G.type === 'collect') return `${this.items[G.item].name} 모으기`;
    if (G.type === 'kill') return `${G.monster ? (this.monsters[G.monster] || {}).name || G.monster : '몬스터'} 처치`;
    if (G.type === 'talk') return `${this.npcName(G.npc)}와(과) 대화`;
    if (G.type === 'go') return `${(this.citymap.nodes.find((n) => n.id === G.map) || {}).name || G.map} 가기`;
    if (G.type === 'floor') return `${G.floor}층 돌파`;
    return G.text || '';
  }

  menuPorterQuest() {
    const s = this.state;
    const tips = this.awakened() ? ['정체를 숨긴 채 탑에 오르면 소문이 퍼진다', '주 스탯을 올리면 데미지가 강해진다', '달리면서 공격하면 돌진 베기'] : ['원정 중 마정석을 주우면 수당이 붙는다', '다친 파티원에게 구급상자를 건넬 수 있다', '자면 월세와 식비가 나간다'];
    return `<div class="left"><b>지금 할 일</b><p class="obj">▶ ${esc(s.objective || '자유롭게 둘러보기')}</p><p class="dim">${s.day + 1}일째 · 31층 기한 D-${Math.max(0, DEADLINE - s.day)}</p></div><div class="detail"><b>알아두기</b>${tips.map((t) => `<p class="dim">· ${esc(t)}</p>`).join('')}</div>`;
  }

  menuSettings() {
    const V = Settings.v;
    const seg = (key, opts) => `<div class="seg">${opts.map(([v, n]) => `<button data-set="${key}" data-v="${v}" class="${String(V[key]) === String(v) ? 'on' : ''}">${n}</button>`).join('')}</div>`;
    const row = (label, html) => `<div class="setrow"><span>${label}</span>${html}</div>`;
    return `<div class="left">${row('조이스틱', seg('joyMode', [['fixed', '고정'], ['float', '자유']]))}${row('조이스틱 크기', seg('joySize', [['s', '작게'], ['m', '보통'], ['l', '크게']]))}${row('민감도', seg('sens', [['s', '낮음'], ['m', '보통'], ['l', '높음']]))}${row('달리기 전환', seg('runAt', [['s', '빨리'], ['m', '보통'], ['l', '끝까지']]))}${row('밀어서 회피', seg('swipeDodge', [[true, '켬'], [false, '끔']]))}${row('화면 확대', seg('zoom', [['s', '가깝게'], ['m', '보통'], ['l', '멀게']]))}</div>
      <div class="detail">${row('기록', '<div class="seg"><button id="sv">저장하기</button></div>')}${row('버튼 크기', seg('btnSize', [['s', '작게'], ['m', '보통'], ['l', '크게']]))}${row('버튼 투명도', seg('btnAlpha', [['s', '흐리게'], ['m', '보통'], ['l', '진하게']]))}${row('왼손 모드', seg('lefty', [[false, '끔'], [true, '켬']]))}${row('버튼 위치', '<div class="seg"><button id="bedit">편집하기</button></div>')}${row('소리', `<div class="seg"><button id="snd" class="${this.sound.enabled ? 'on' : ''}">${this.sound.enabled ? '켜짐' : '꺼짐'}</button><button id="tt">타이틀로</button></div>`)}</div>`;
  }

  bindMenu(tab) {
    const s = this.state;
    this.ov.querySelectorAll('[data-slot]').forEach((b) => (b.onclick = () => {
      const i = Number(b.dataset.slot), ai = Number(this.skillSel.slice(1)), m = (s.slotMap = s.slotMap || [0, 1, 2, 3]);
      const j = m.indexOf(ai); if (j >= 0) m[j] = m[i]; m[i] = ai; this.worldButtons(); this.renderMenu(`${i + 1}번 칸에 놓았다`);
    }));
    const gf = this.ov.querySelector('[data-gift]'); if (gf) gf.onclick = () => { const m = this.giveGift(gf.dataset.gift); if (m) this.renderMenu(m); };
    if (tab === 'bag') {
      this.ov.querySelectorAll('[data-b]').forEach((b) => (b.onclick = () => { this.bagSel = b.dataset.b; this.renderMenu(); }));
      this.ov.querySelectorAll('[data-pg]').forEach((b) => (b.onclick = () => { this.bagPage = Math.max(0, this.bagPage + Number(b.dataset.pg)); this.renderMenu(); }));
      const u = this.ov.querySelector('[data-use]'); if (u) u.onclick = () => { const id = u.dataset.use, it = this.items[id]; const m = this.useItem(id); if (this.menuOpen) this.renderMenu(m || it.name + ' 사용'); };
      const qk = this.ov.querySelector('[data-quick]'); if (qk) qk.onclick = () => { s.quickItem = qk.dataset.quick; this.worldButtons(); this.renderMenu('빠른 사용으로 지정했다'); };
    }
    this.ov.querySelectorAll('[data-g]').forEach((b) => (b.onclick = () => { this.gearSel = b.dataset.g; this.renderMenu(); }));
    this.ov.querySelectorAll('[data-gp]').forEach((b) => (b.onclick = () => { this.gearPage = Math.max(0, (this.gearPage || 0) + Number(b.dataset.gp)); this.renderMenu(); }));
    const eq = this.ov.querySelector('[data-equ]'); if (eq) eq.onclick = () => { if (this.gear.equip(eq.dataset.equ)) { s.hp = Math.min(s.hp, this.maxHp()); this.sound.sfx('select'); this.renderMenu(this.gear.item(eq.dataset.equ).name + ' 장착'); } };
    const ue = this.ov.querySelector('[data-uneq]'); if (ue) ue.onclick = () => { this.gear.unequip(ue.dataset.uneq); s.hp = Math.min(s.hp, this.maxHp()); this.renderMenu('해제했다'); };
    const en = this.ov.querySelector('[data-enh]'); if (en) en.onclick = () => { const r = this.gear.enhance(en.dataset.enh); this.sound.sfx(r.ok ? 'levelup' : 'hurt'); this.renderMenu(r.msg); };
    this.ov.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => { const pd = this.pend || (this.pend = {}); const used = Object.values(pd).reduce((a, c) => a + c, 0); if (s.pts - used > 0) { pd[b.dataset.k] = (pd[b.dataset.k] || 0) + 1; this.renderMenu(); } }));
    this.ov.querySelectorAll('[data-set]').forEach((b) => (b.onclick = () => { let v = b.dataset.v; if (v === 'true') v = true; if (v === 'false') v = false; Settings.v[b.dataset.set] = v; Settings.save(); this.view.applyZoom(); this.renderMenu(); }));
    const sv = this.ov.querySelector('#sv'); if (sv) sv.onclick = () => { this.save(); this.renderMenu('저장했어요'); };
    const cv = this.ov.querySelector('#stp'); if (cv) { const pf = this.portraitOf('gen:player'); const x = cv.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(pf.im, 0, 0); }
    this.ov.querySelectorAll('[data-sk]').forEach((b) => (b.onclick = () => { this.skillSel = b.dataset.sk; this.renderMenu(); }));
    const su = this.ov.querySelector('[data-skup]'); if (su) su.onclick = () => { const k = su.dataset.skup; this.skPend = this.skPend || {}; this.skPend[k] = (this.skPend[k] || 0) + 1; this.renderMenu(); };
    const sr = this.ov.querySelector('#skreset'); if (sr) sr.onclick = () => { this.skPend = {}; this.renderMenu(); };
    const sa = this.ov.querySelector('#skapply'); if (sa) sa.onclick = () => { const pd = this.skPend || {}; let n = 0; for (const k in pd) { (k[0] === 'a' ? s.sk.a : s.sk.p)[Number(k.slice(1))] += pd[k]; n += pd[k]; } s.skp -= n; this.skPend = {}; this.sound.sfx('levelup'); this.renderMenu('스킬을 배웠습니다'); };
    const ap = this.ov.querySelector('#apply'); if (ap) ap.onclick = () => { const pd = this.pend || {}; let n = 0; for (const k in pd) { s.stats[k] += pd[k]; n += pd[k]; if (k === 'vit') s.hp += 12 * pd[k]; } s.pts -= n; this.pend = {}; this.sound.sfx('levelup'); this.renderMenu('적용했습니다'); };
    const pr = this.ov.querySelector('#preset'); if (pr) pr.onclick = () => { this.pend = {}; this.renderMenu(); };
    const snd = this.ov.querySelector('#snd'); if (snd) snd.onclick = () => { this.sound.toggle(); this.renderMenu(); };
    const be = this.ov.querySelector('#bedit'); if (be) be.onclick = () => this.openButtonEditor();
    const tt = this.ov.querySelector('#tt'); if (tt) tt.onclick = () => { this.save(); this.menuOpen = false; this.showTitle(); };
    this.ov.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { this.questSel = b.dataset.q; this.renderMenu(); }));
    this.ov.querySelectorAll('[data-qp]').forEach((b) => (b.onclick = () => { this.questPage = Math.max(0, (this.questPage || 0) + Number(b.dataset.qp)); this.renderMenu(); }));
    const tr = this.ov.querySelector('[data-track]'); if (tr) tr.onclick = () => { s.track = tr.dataset.track; this.quests.sync(); this.renderMenu('추적합니다'); };
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
    const goal = s.objTarget ? nodeOf(s.objTarget.map) : null;
    const P = (n) => [n.mx * W, n.my * H];
    const bg = this.A.ui && this.A.ui.worldmap;
    if (bg && bg.im && !bg.missing) x.drawImage(bg.im, 0, 0, W, H);
    else {
      // 그림 지도가 들어오기 전까지 쓰는 지도
      x.fillStyle = '#5f7f4f'; x.fillRect(0, 0, W, H);
      for (let i = 0; i < 40; i++) { x.fillStyle = i % 2 ? '#587748' : '#668656'; x.fillRect((i * 97) % W, (i * 53) % H, 30, 18); }
      x.fillStyle = '#3a78b8'; x.beginPath(); x.moveTo(0, H * 0.08); x.bezierCurveTo(W * 0.3, H * 0.02, W * 0.6, H * 0.16, W, H * 0.06); x.lineTo(W, H * 0.16); x.bezierCurveTo(W * 0.6, H * 0.26, W * 0.3, H * 0.12, 0, H * 0.18); x.fill();
      x.fillStyle = '#7a7d84'; x.fillRect(0, H * 0.74, W, H * 0.06);
    }
    for (const [a, b] of cm.links) {
      const A = P(cm.nodes.find((n) => n.id === a)), B = P(cm.nodes.find((n) => n.id === b));
      x.strokeStyle = '#4a4d55'; x.lineWidth = 12; x.beginPath(); x.moveTo(A[0], A[1]); x.lineTo(B[0], B[1]); x.stroke();
      x.strokeStyle = '#e6e2c8'; x.lineWidth = 1.5; x.setLineDash([6, 6]); x.beginPath(); x.moveTo(A[0], A[1]); x.lineTo(B[0], B[1]); x.stroke(); x.setLineDash([]);
    }
    for (const n of cm.nodes) {
      const [px, py] = P(n), seen = s.visited && s.visited[n.id];
      x.fillStyle = seen ? 'rgba(20,16,12,0.8)' : 'rgba(20,16,12,0.5)';
      x.beginPath(); x.arc(px, py, 20, 0, Math.PI * 2); x.fill();
      x.strokeStyle = here === n ? '#ffd23f' : '#c9a24a'; x.lineWidth = here === n ? 3 : 1.5; x.stroke();
      x.font = '18px system-ui'; x.textAlign = 'center'; x.globalAlpha = seen ? 1 : 0.35; x.fillText(n.icon, px, py + 6); x.globalAlpha = 1;
      x.font = '700 11px system-ui'; x.lineWidth = 3; x.strokeStyle = '#000'; x.fillStyle = seen ? '#fff' : '#aaa';
      const label = seen ? n.name : '???'; x.strokeText(label, px, py + 34); x.fillText(label, px, py + 34);
      if (here === n) { const T2 = performance.now() / 300; x.fillStyle = '#ff4a4a'; x.beginPath(); x.moveTo(px, py - 24); x.lineTo(px - 7, py - 36 - Math.sin(T2) * 2); x.lineTo(px + 7, py - 36 - Math.sin(T2) * 2); x.fill(); }
      if (goal === n) { x.font = '16px system-ui'; x.fillText('⭐', px + 22, py - 16); }
    }
    x.textAlign = 'left'; x.font = '700 12px system-ui'; x.fillStyle = '#fff'; x.strokeStyle = '#000'; x.lineWidth = 3;
    x.strokeText('한성특별시', 10, 18); x.fillText('한성특별시', 10, 18);
    x.font = '600 10px system-ui'; x.strokeText('🔻 현재 위치  ⭐ 목표', 10, H - 8); x.fillText('🔻 현재 위치  ⭐ 목표', 10, H - 8);
  }


  // ---------- 짐꾼 원정 ----------
  gather() {
    const s = this.state;
    s.objective = ''; s.objTarget = null;
    this.ow.goto('plaza', [18, 9], 'R').then(() => {
      const lead = { speaker: this.npcName('taesung'), portrait: this.portraitKey('taesung') };
      const lines = s.porterDepth >= 9
        ? [{ ...lead, text: '오늘은 10층 보스방 앞까지. 들어가면 짐 내려놓고 뒤에 붙어 있어.' }]
        : s.porterDepth === 0
          ? [{ ...lead, text: '네가 새 짐꾼이구나. 짐 들고 뒤에만 붙어 있어. 싸움은 우리가 한다.' }, { speaker: this.npcName('yuna'), portrait: this.portraitKey('yuna'), text: '잘 부탁해요! 다치면 저한테 말하고요.' }]
          : [{ ...lead, text: this.pick(['오늘도 세 층. 가자.', '어제처럼만 하면 돼. 출발.', '짐 챙겼지? 가자.']) }];
      this.runLines(lines, () => this.startExpedition());
    });
  }

  startExpedition() {
    const s = this.state;
    const start = Math.min(10, s.porterDepth + 1);
    this.dayShards = 0;
    if (start >= 10) { this.startRift(); return; }
    this.expFloors = [start, start + 1, start + 2].filter((n) => n <= 9);
    this.startPorterFloor(this.expFloors.shift());
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
    if (!this.state.flags.porterTip) { this.state.flags.porterTip = true; this.runLines([
      { text: '[조작] 떨어진 마정석 근처에서 큰 버튼으로 줍기. 붉은 경고가 뜨면 회피. 다친 파티원 위에 !가 뜨면 다가가서 구급상자를 건넬 수 있다.' }]); }
  }

  porterGoal() {
    const s = this.state, n = this.porter.floor.n;
    s.porterDepth = Math.max(s.porterDepth, n);
    this.dayShards += this.porter.shards;
    if (this.expFloors && this.expFloors.length) {
      this.toast(`${n}층 정리 · 다음 층으로`);
      setTimeout(() => { if (this.mode === 'porter') this.startPorterFloor(this.expFloors.shift()); }, 1200);
      return;
    }
    const lead = { speaker: this.npcName('taesung'), portrait: this.portraitKey('taesung') };
    this.runLine({ ...lead, text: n >= 9 ? '9층까지 왔다. 다음엔 10층 보스방 앞까지 간다. 일당 두 배.' : '오늘은 여기까지. 수고했다.' }, () => this.endExpedition());
  }

  endExpedition() {
    const s = this.state;
    const pay = WAGE + this.dayShards * SHARD_BONUS;
    s.money += pay - LIVING_COST;
    s.day++; this.newDay();
    for (const id of ['taesung', 'yuna', 'hyun', 'eunji']) this.aff(id, 2);   // 함께 원정
    s.flags.jobToday = false; s.flags.workedToday = false;
    s.hp = this.maxHp();
    s.objective = s.porterDepth >= 9 ? '사무소에서 10층 의뢰 받기' : '사무소에서 다음 의뢰 받기';
    s.objTarget = { map: 'office', at: [2, 2] };
    this.porter = null;
    this.enterWorldMode();
    this.ow.load('room', [3, 4], 'D').then(() => {
      this.runLine({ text: `일당 ${won(WAGE)} + 회수 수당 ${won(this.dayShards * SHARD_BONUS)}. 월세와 식비 ${won(LIVING_COST)}을 빼고 남은 돈 ${won(s.money)}.\n하루가 지났다. 31층 기한 D-${Math.max(0, DEADLINE - s.day)}.` }, () => this.save());
    });
  }

  onPorterDeath() {
    this.state.dead = true; Save.wipe(); this.sound.stopMusic(); this.sound.sfx('death');
    setTimeout(() => this.showEnd(), 2200);
  }

  startRift() {
    this.porter = null;
    this.enterWorldMode();
    this.ow.load('floor10', [7, 10], 'U').then(() => this.ow.play('rift'));
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

  enterFloor(n, custom) {
    this.drops = [];
    const s = this.state, f = custom || this.floors[n - 1];
    if (!custom) this.eventFightCb = null;
    this.floor = f; this.kills = 0; this.boss = null; this.floorDone = false;
    const map = Object.assign({}, this.mapTemplate, { seed: f.seed, tint: f.tint });
    if (f.propsMix) map.props = f.propsMix.map(([set, count]) => ({ kind: ['grass', 'shroom', 'rocks', 'crystal'].includes(set) ? 'deco' : set === 'bush' ? 'bush' : 'tree', set, count, col: ['grass', 'shroom', 'rocks', 'crystal'].includes(set) ? 0 : 26, minDist: 60 + (count < 20 ? 60 : 0) }));
    // 일반 층은 미로형: 보스방을 찾아 보스 처치. 이벤트 전투는 예전 넓은 들판
    const mz = !custom;
    if (mz) {
      const sets = (f.propsMix || []).map(([k]) => k);
      const walls = sets.filter((k) => ['pine', 'tree', 'bush', 'boulder', 'crystal', 'stump', 'log'].includes(k));
      const deco = sets.filter((k) => ['grass', 'rocks', 'shroom'].includes(k));
      map.wallColor = /동굴|유적/.test(f.name) ? '#1d1a26' : '#16301a';
      const biome = this.biomeOf(f.name);
      if (this.A.tower2) map.tint = null;
      this.world = new MazeWorld(this.A, map, { biome, walls: walls.length ? walls : ['pine', 'tree', 'bush'], deco: deco.length ? deco : ['grass', 'rocks'] });
    } else this.world = new World(this.A, map);
    this.fx = new FX(this.A, this.view);
    this.player = new Player(this, this.world.spawn.x, this.world.spawn.y);
    this.sk.reset(); this.sk.ensure();
    // 미로 층은 몬스터가 더 많다
    this.enemies = new Enemies(this, this.monsters, mz ? Object.assign({}, f, { spawns: f.spawns.map((sp) => ({ ...sp, count: Math.ceil(sp.count * 2.5) })) }) : f);
    this.allies = mz ? new Allies(this, this.world) : null;
    if (mz && f.boss) { const B = this.world.boss, b = this.enemies.spawnBoss(f.boss); b.dormant = true; b.x = (B.cx + 0.5) * this.world.TW; b.y = (B.cy + 0.5) * this.world.TH; }
    this.view.cam.x = this.player.x; this.view.cam.y = this.player.y;
    this.mode = 'field';
    this.sound.play('field');
    this.fieldButtons();
    if (!s.flags.fieldTip) { s.flags.fieldTip = true; this.hud.hintT = 8; }
  }

  fieldButtons() { this.worldButtons(); }

  healItem() {
    const s = this.state;
    if (s.quickItem && (s.inv[s.quickItem] || 0) > 0 && (this.mode !== 'porter' || this.items[s.quickItem].heal)) return s.quickItem;
    const order = this.mode === 'porter' ? ['painkiller', 'ramen', 'potion'] : ['potion', 'painkiller', 'ramen'];
    return order.find((id) => (s.inv[id] || 0) > 0);
  }

  quickHeal() {
    const id = this.healItem();
    if (!id) { this.toast('빠른 사용 아이템이 없다'); return; }
    const m = this.useItem(id); if (m) this.toast(m);
  }

  layoutButtons() {
    const v = this.view, W = v.W, H = v.H, k = Settings.btnK(), L = Settings.v.lefty;
    const X = (x) => (L ? x : W - x);
    const B = [];
    const s = this.state;
    const playing = ['world', 'porter', 'field'].includes(this.mode) && !(this.mode === 'world' && this.ow.cut);
    if (playing) {
      B.push({ id: 'menu', top: true, x: 28, y: 28, r: 18, label: '☰' });
      B.push({ id: 'map', top: true, x: 70, y: 28, r: 18, label: '지도' });
      B.push({ id: 'quest', top: true, x: 112, y: 28, r: 18, label: '!' });
    }
    if (this.mode === 'porter' && this.porter && !this.editBtns) {
      const lab = this.porter.prompt ? (this.porter.prompt.kind === 'drop' ? '줍기' : '건네기') : '줍기';
      B.push({ id: 'act', icon: 'talk', x: X(70 * k), y: H - 70 * k, r: 40 * k, label: lab });
      B.push({ id: 'dodge', x: X(150 * k), y: H - 38 * k, r: 26 * k, label: '회피', cd: this.porter.me.cd || 0, cdMax: 0.9 });
      const hid = this.healItem(); B.push({ id: 'potion', iconItem: hid ? 'item_' + hid : null, x: X(148 * k), y: H - 112 * k, r: 22 * k, label: hid ? this.items[hid].name.slice(0, 3) : '없음', sub: hid ? s.inv[hid] : 0 });
    } else if ((this.mode === 'field' && this.world) || (this.mode === 'world' && !this.ow.cut) || this.editBtns) {
      B.push({ id: 'act', icon: 'act', x: X(72 * k), y: H - 72 * k, r: 42 * k, label: '공격' });
      // 마을: 공격 버튼 하나로 말 걸기·조사도 한다. PK 켜기/끄기는 스킬 슬롯 바깥 위쪽
      const use = (this.mode === 'world' && this.actTarget()) || (this.mode === 'field' && this.pickTarget() && { label: this.pickTarget().chest ? '열기' : this.pickTarget().ore ? '채굴' : '줍기' });
      if (use) { const a0 = B[B.length - 1]; a0.icon = 'talk'; a0.label = use.label.length > 4 ? use.label.slice(0, 4) : use.label; }
      if (this.mode === 'world' || this.editBtns) B.push({ id: 'pk', x: X(30 * k), y: H - 212 * k, r: 18 * k, label: Settings.v.pk ? 'PK켬' : 'PK끔', warn: !!Settings.v.pk });
      const pl = this.player || { cds: {}, dg: { cd: 1 } }, D = this.skills[s.job];
      B.push({ id: 'dodge', x: X(160 * k), y: H - 40 * k, r: 26 * k, label: '회피', cd: pl.cds.dodge, cdMax: pl.dg.cd });
      const pos = [[150, 112], [112, 156], [58, 172], [212, 150]];
      for (let i = 0; i < 4 && this.awakened(); i++) {
        const ai = this.slotIdx(i), a = D && D.active[ai], L = a ? this.sk.lv('a', ai) : 0;
        B.push({ id: 'skill' + (i + 1), x: X(pos[i][0] * k), y: H - pos[i][1] * k, r: (i === 3 ? 26 : 24) * k, label: a ? a.name.slice(0, 4) : '', cost: a && L ? a.mp : 0, cd: pl.cds['s' + ai], cdMax: (pl.cdMax && pl.cdMax['s' + ai]) || 1, locked: !L, ult: ai === 3 });
      }
      const hid = this.healItem(); B.push({ id: 'potion', iconItem: hid ? 'item_' + hid : null, x: X(228 * k), y: H - 84 * k, r: 20 * k, label: hid ? this.items[hid].name.slice(0, 3) : '없음', sub: hid ? s.inv[hid] : 0 });
    }
    for (const b of B) { const o = Settings.v.btnPos && Settings.v.btnPos[b.id]; if (o) { b.x += o[0]; b.y += o[1]; } const sc = Settings.v.btnScale && Settings.v.btnScale[b.id]; if (sc) b.r *= sc / 100; }
    const out = this.talking || (this.menuOpen && !this.editBtns) ? [] : B;
    if (this.mode === 'world' && this.ow.cut && !this.menuOpen) out.push({ id: 'skip', top: true, always: true, x: W - 40, y: 26, r: 20, label: 'SKIP' });
    this.input.buttons = out;
  }

  // 받은 그림으로 탑 층 타일·소품 교체 (없으면 기존 그림 유지)
  applyArt() {
    const A = this.A, ok = (o) => o && o.w && !o.missing;
    if (A.ftiles) for (const k of ['grass', 'flower']) if (ok(A.ftiles[k])) A.tiles[k] = [A.ftiles[k]];
    const P = A.fprops; if (!P) return;
    const set = (name, keys) => { const l = keys.map((k) => P[k]).filter(ok); if (l.length) A.props[name] = l; };
    set('pine', ['pine']); set('pine2', ['pine']); set('tree', ['tree']); set('bush', ['bush']); set('grass', ['tallgrass']); set('small', ['rocks', 'shroom', 'stump']);
    for (const k of ['boulder', 'log', 'rune', 'crystal', 'stump', 'shroom', 'rocks']) set(k, [k]);
  }

  // 11~30층: 받은 맵 그림으로 무작위 구성 (바이옴 색감·소품 조합·몬스터 조합이 층마다 다름)
  genFloors() {
    if (this.floors.length >= 30) return;
    const B = [
      { name: '안개 숲', tint: 'saturate(0.7) brightness(0.85)', props: [['pine', 50], ['tree', 20], ['bush', 40], ['log', 10], ['rocks', 40], ['grass', 50]] },
      { name: '수정 동굴 입구', tint: 'hue-rotate(95deg) saturate(0.7) brightness(0.8)', props: [['crystal', 40], ['boulder', 30], ['rocks', 50], ['rune', 6], ['bush', 20]] },
      { name: '황혼의 평원', tint: 'sepia(0.45) saturate(1.4) hue-rotate(-18deg)', props: [['tree', 30], ['bush', 50], ['stump', 20], ['grass', 70], ['shroom', 20]] },
      { name: '고목의 숲', tint: 'saturate(0.85) brightness(0.72)', props: [['tree', 40], ['pine', 40], ['stump', 30], ['log', 20], ['shroom', 40]] },
      { name: '룬의 유적', tint: 'grayscale(0.6) sepia(0.3) brightness(0.85)', props: [['rune', 14], ['boulder', 40], ['rocks', 60], ['stump', 10], ['crystal', 15]] },
    ];
    const pool = ['slime_purple', 'mushroom', 'bee', 'toad', 'bat', 'spider', 'treant', 'wolf'];
    const bosses = ['stag', 'wolf_alpha', 'rift_guardian'];
    let seed = 9137;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let n = this.floors.length + 1; n <= 30; n++) {
      const b = B[(n - 11) % B.length];
      const types = [...pool].sort(() => rnd() - 0.5).slice(0, 3);
      this.floors.push({
        n, name: `${n}층 ${b.name}`, map: 'floor01', seed: 1000 + n * 7919, hpMul: 1 + 0.25 * (n - 1), dmgMul: 1 + 0.15 * (n - 1), goal: 10 + Math.floor(n / 3),
        boss: n % 5 === 0 ? bosses[(n / 5) % bosses.length] : bosses[n % bosses.length],
        spawns: types.map((t, i) => ({ type: t, count: i === 0 ? 4 : 2 })),
        tint: b.tint, propsMix: b.props,
      });
    }
  }

  // HTML 창(메뉴, 상점 등)에도 그림 테두리를 입힌다
  applyCssSkin() {
    const U = this.A.ui; if (!U) return;
    const root = document.documentElement.style;
    let any = false;
    for (const [n, v] of [['panel', '--skin-plain'], ['panel_sys', '--skin-sys'], ['btn', '--btn-plain'], ['btn_sys', '--btn-sys']]) {
      const o = U[n]; if (o && o.im && !o.missing) { root.setProperty(v, `url(${o.im.toDataURL()})`); any = true; }
    }
    if (any) document.documentElement.classList.add('skinned');
  }

  // 버튼 위치 편집: 버튼을 끌어 옮기고 저장
  openButtonEditor() {
    this.menuOpen = true; this.editBtns = true; this.input.reset();
    // 한 화면에서: 끌어서 옮기고, 누른 버튼(또는 조이스틱)은 아래 막대로 크기 조절
    Settings.v.btnPos = Settings.v.btnPos || {}; Settings.v.btnScale = Settings.v.btnScale || {}; Settings.v.joyPos = Settings.v.joyPos || [0, 0];
    let sel = null, drag = null;
    const bar = () => {
      const v = sel === 'joy' ? Settings.v.joyScale || 100 : (sel && Settings.v.btnScale[sel]) || 100;
      this.ov.innerHTML = `<div class="editbar"><span>${sel ? (sel === 'joy' ? '조이스틱' : '선택한 버튼') + ' 크기' : '끌어서 옮기기 · 누르면 크기 조절'}</span>${sel ? `<input id="ebs" type="range" min="60" max="170" value="${v}">` : ''}<button id="ebr">초기화</button><button class="primary" id="ebd">완료</button></div>`;
      const sl = this.ov.querySelector('#ebs'); if (sl) sl.oninput = () => { if (sel === 'joy') Settings.v.joyScale = Number(sl.value); else Settings.v.btnScale[sel] = Number(sl.value); this.worldButtons(); };
      this.ov.querySelector('#ebr').onclick = () => { Settings.v.btnPos = {}; Settings.v.btnScale = {}; Settings.v.joyPos = [0, 0]; Settings.v.joyScale = 100; Settings.save(); this.worldButtons(); };
      this.ov.querySelector('#ebd').onclick = () => { this.input.editor = null; this.editBtns = false; Settings.save(); this.closeMenu(); };
    };
    this.input.editor = {
      down: (x, y) => {
        const b = this.input.buttons.find((q) => !q.top && Math.hypot(x - q.x, y - q.y) < q.r * 1.2), J = this.input.joyBase();
        if (b) { drag = { id: b.id, off: [x, y] }; sel = b.id; } else if (Math.hypot(x - J.x, y - J.y) < J.r * 1.2) { drag = { id: 'joy', off: [x, y] }; sel = 'joy'; } else return;
        bar();
      },
      move: (x, y) => {
        if (!drag) return; const dx = x - drag.off[0], dy = y - drag.off[1]; drag.off = [x, y];
        if (drag.id === 'joy') { const o = Settings.v.joyPos; Settings.v.joyPos = [o[0] + dx, o[1] + dy]; }
        else { const o = Settings.v.btnPos[drag.id] || [0, 0]; Settings.v.btnPos[drag.id] = [o[0] + dx, o[1] + dy]; }
        this.worldButtons();
      },
      up: () => { drag = null; Settings.save(); },
    };
    bar();
  }

  applyTheme() { document.body.className = this.state && this.mode !== 'title' && this.mode !== 'create' && this.awakened() ? 'sys' : 'plain'; }

  sysPopup(lines, cb) {
    this.menuOpen = true; this.input.reset();
    let i = 0;
    const show = () => {
      if (i >= lines.length) { this.ov.innerHTML = ''; this.menuOpen = false; cb && cb(); return; }
      const L = lines[i];
      this.ov.innerHTML = `<div class="sysmsg"><div class="win"><div class="h">${esc(L.h || '알림')}</div><p>${esc(this.fmt(L.t))}</p><div class="t">화면을 눌러 계속</div></div></div>`;
      this.sound.sfx('select');
      this.ov.querySelector('.sysmsg').onclick = () => { i++; show(); };
    };
    document.body.className = 'sys';
    show();
  }

  goalText() {
    if (this.mode === 'porter') return `파티 처치 ${this.porter.kills} / ${this.porter.goal} · 회수 ${this.porter.shards}`;
    const f = this.floor; if (!f) return '';
    if (this.floorDone) return '목표 완료';
    if (this.world && this.world.maze) return this.boss ? '보스를 쓰러뜨리세요' : '보스방을 찾아 보스 처치';
    if (this.boss) return '보스를 쓰러뜨리세요';
    return `목표 처치 ${this.kills} / ${f.goal}`;
  }

  onKill(e) {
    const s = this.state;
    s.kills++; this.kills++;
    this.events.countKill(e.type); this.quests.on('kill', { monster: e.type });
    this.fx.num(e.x, e.y - 100, '+' + e.d.exp + ' EXP', 'exp');
    if (e.d.money) s.money += Math.round(e.d.money[0] + Math.random() * (e.d.money[1] - e.d.money[0]));
    // 아이템은 바닥에 떨어지고 직접 줍는다
    const drop = (id) => (this.drops = this.drops || []).push({ id, x: e.x + (Math.random() - 0.5) * 60, y: e.y + (Math.random() - 0.5) * 30, t: 0 });
    if (e.d.drop) for (const id in e.d.drop) if (Math.random() < e.d.drop[id]) drop(id);
    const gd = this.gear.rollDrop(e); if (gd) drop(gd);
    s.rumor += 0.02;
    if (!e.lastAlly) this.gainExp(e.d.exp);
    if (e === this.boss) { this.clearFloor(); return; }
    if (!this.floorDone && !this.boss && !(this.world && this.world.maze) && this.kills >= this.floor.goal) { this.boss = this.enemies.spawnBoss(this.floor.boss); this.hud.say('강한 기운이 다가온다'); this.sound.play('boss'); }
  }

  clearFloor() {
    if (this.eventFightCb) { const cb = this.eventFightCb; this.eventFightCb = null; this.floorDone = true; setTimeout(() => { this.world = null; this.player = null; this.boss = null; cb(); }, 1200); return; }
    const s = this.state, n = this.floor.n;
    this.floorDone = true; this.sound.play('hub'); if (this.world) { this.world.cleared = true; this.world.locked = false; }
    if (!s.cleared[n]) s.rumor += 1;
    s.cleared[n] = true; s.unlocked = Math.max(s.unlocked, n + 1); this.quests.sync(); this.save();
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

  // 이벤트 전투: 컷신 도중 전투로 들어갔다가 목표를 채우면 컷신으로 돌아온다
  eventFight(def, done) {
    const f = Object.assign({ n: 0, name: def.name || '전투', seed: 777, hpMul: 1, dmgMul: 1, goal: def.goal || 1, boss: def.boss }, { spawns: def.spawns || [] });
    this.eventFightCb = done; this.eventSafe = !!def.safe;
    this.enterFloor(0, f);
    if (def.boss && def.bossNow) { this.boss = this.enemies.spawnBoss(def.boss); this.sound.play('boss'); }
    if (def.hint) this.toast(def.hint);
  }

  backToPlaza() {
    this.passTime(1); this.drops = [];
    this.world = null; this.player = null; this.floor = null; this.boss = null;
    this.enterWorldMode();
    this.ow.load('plaza', [7, 3], 'D').then(() => this.save());
  }

  onPlayerDeath() {
    if (this.eventSafe && this.eventFightCb) { this.state.hp = 1; this.player.state = 'idle'; this.player.inv = 2; this.toast('아직 쓰러질 수 없다'); return; }
    this.state.dead = true; Save.wipe(); this.sound.stopMusic(); this.sound.sfx('death'); setTimeout(() => this.showEnd(), 2600); }

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
    if (this.flashHurt) this.flashHurt = Math.max(0, this.flashHurt - dt);
    if (this.flashParry) this.flashParry = Math.max(0, this.flashParry - dt);
    if (this.state && ['field', 'porter', 'world'].includes(this.mode) && !this.talking && !this.menuOpen) {
      this.combatT = (this.combatT || 0) + dt;
      const s0 = this.state;
      if (s0.mp === undefined) s0.mp = this.maxMp();
      if (this.combatT > 5 && !(this.player && this.player.state === 'dead')) {
        s0.hp = Math.min(this.maxHp(), s0.hp + this.maxHp() * 0.01 * dt);
        s0.mp = Math.min(this.maxMp(), s0.mp + this.maxMp() * 0.02 * dt);
      }
    }
    if (this.target) { this.target.t -= dt; if (this.target.t <= 0) this.target = null; }
    if (this.talking && this.mode === 'world' && this.ow.cut && this.ow.cut.ff && this.dialogue.cur && !(this.dialogue.cur.choices && this.dialogue.cur.choices.length)) { this.dialogue.t = 999; this.dialogue.next(); }
    if (this.state && !busy && ['world', 'field', 'porter'].includes(this.mode)) {
      const B = this.state.buffs; if (B) for (const k in B) { B[k].t -= dt; if (B[k].t <= 0) delete B[k]; }
      const mr = this.gear.opt('mpRegen'); if (mr && this.awakened()) this.state.mp = Math.min(this.maxMp(), (this.state.mp || 0) + mr * dt);
    }
    if (this.mode === 'world') {
      if (!busy && this.hitstop > 0) { this.hitstop -= dt; if (this.fx) for (const f of this.fx.list) f.t += dt * 0.3; return; }
      if (!busy) { this.comboT = Math.max(0, this.comboT - dt); if (this.comboT <= 0) this.comboN = 0; }
      this.ow.update(busy ? 0 : dt); if (busy && this.ow.cut) this.ow.cut.update(0);
      if (!busy && !this.ow.cut) { if (this.awakened()) this.sk.update(dt); }
      if (this.fx) this.fx.update(busy ? 0 : dt);
    }
    else if (this.mode === 'porter' && this.porter) {
      if (!busy && !this.porter.dead) this.porter.update(dt);
      this.fx.update(busy ? 0 : dt);
      const w = this.porter.world;
      this.view.follow(this.porter.me.x, this.porter.me.y, dt, { w: w.w, h: w.h });
    } else if (this.mode === 'field' && this.world) {
      if (busy) return;
      if (this.hitstop > 0) { this.hitstop -= dt; for (const f of this.fx.list) f.t += dt * 0.3; return; }
      this.comboT = Math.max(0, this.comboT - dt); if (this.comboT <= 0) this.comboN = 0;
      this.player.update(dt); this.enemies.update(dt); this.sk.update(dt); this.fx.update(dt);
      this.view.follow(this.player.x, this.player.y, dt, { w: this.world.w, h: this.world.h });

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
      if (!this.ow.cut && !this.talking) { this.hud.drawWorld(); this.ow.drawMinimap(v.W - 12, 52, 150, 64); }
      this.hud.drawControls();
    } else if (this.mode === 'porter' && this.porter) {
      this.porter.draw();
      v.screen();
      if (!this.talking) this.hud.drawPorter();
      this.hud.drawControls();
    } else if (this.mode === 'field' && this.world) {
      v.world();
      this.world.drawGround(v);
      this.fx.draw(true);
      const list = [];
      this.world.collectProps(v, list); this.enemies.collect(list); this.player.collect(list);
      list.sort((a, b) => a.y - b.y).forEach((o) => o.d());
      this.sk.draw();
      this.fx.draw(false); this.fx.drawNums();
      v.screen();
      this.hud.draw();
      this.hud.drawControls();
    } else {
      const g = ctx.createRadialGradient(v.W / 2, v.H / 2, 40, v.W / 2, v.H / 2, Math.max(v.W, v.H) * 0.7);
      g.addColorStop(0, '#2a2018'); g.addColorStop(1, '#0d0a08');
      ctx.fillStyle = g; ctx.fillRect(0, 0, v.W, v.H);
    }
    if (this.flashParry > 0) { ctx.fillStyle = `rgba(200,240,255,${this.flashParry * 2})`; ctx.fillRect(0, 0, v.W, v.H); }
    if (this.flashHurt > 0 && ['field', 'porter'].includes(this.mode)) {
      const gr = ctx.createRadialGradient(v.W / 2, v.H / 2, Math.min(v.W, v.H) * 0.3, v.W / 2, v.H / 2, Math.max(v.W, v.H) * 0.7);
      gr.addColorStop(0, 'rgba(255,0,0,0)'); gr.addColorStop(1, `rgba(220,20,20,${this.flashHurt * 1.6})`);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, v.W, v.H);
    }
    if (this.talking) this.hud.drawDialogue(this.dialogue);
  }
}

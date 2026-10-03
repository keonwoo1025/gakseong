// 걸어 다니는 장소(집, 거리, 사무소 등)와 컷신.
// 지도는 data/town/*.json, 컷신은 data/cutscenes/*.json.
import { makePerson, makeTiles, SOLID } from './pixel.js';
import { Settings } from '../engine/settings.js';

export const TS = 64;   // 타일 한 칸: 16px 도트 x4
const PS = 3.2;         // 사람 도트 확대 배율 (키가 타일 약 1.3칸)
const DIRV = { D: [0, 1], U: [0, -1], R: [1, 0], L: [-1, 0] };

export class Overworld {
  constructor(g) {
    this.g = g;
    this.map = null; this.actors = {}; this.tiles = {}; this.mobs = [];
    this.cut = null; this.fade = 0; this.fadeTo = 0; this.camTarget = 'player';
    this.prompt = null; this.flash = [];
  }

  // ---------- 지도 ----------
  async load(id, spawn, dir) {
    const m = await this.g.getJSON(`data/town/${id}.json`);
    this.map = m;
    this.tiles = makeTiles(m.theme);
    this.grid = m.rows.map((r) => [...r].map((ch) => m.legend[ch] || 'void'));
    this.W = this.grid[0].length * TS; this.H = this.grid.length * TS;
    const keep = this.actors.player;
    this.actors = {};
    this.mobs = [];
    const p = keep || this.makeActor('player', this.g.playerLook());
    const cols = this.grid[0].length, rows = this.grid.length;
    let at = (spawn || m.spawn || [1, 1]).slice();
    if (at[0] < 0) at[0] += cols; if (at[1] < 0) at[1] += rows;
    at[0] = Math.max(0, Math.min(cols - 1, at[0])); at[1] = Math.max(0, Math.min(rows - 1, at[1]));
    if (SOLID.has(this.grid[at[1]][at[0]])) {
      let best = null;
      for (let d = 1; d < Math.max(cols, rows) && !best; d++) for (const [dx, dy] of [[0, d], [0, -d], [d, 0], [-d, 0]]) {
        const c = at[0] + dx, r = at[1] + dy;
        if (r >= 0 && c >= 0 && r < rows && c < cols && !SOLID.has(this.grid[r][c]) && this.grid[r][c] !== 'door') { best = [c, r]; break; }
      }
      if (best) at = best;
    }
    p.x = (at[0] + 0.5) * TS; p.y = (at[1] + 0.8) * TS; p.dir = dir || p.dir || 'D'; p.path = null; p.knock = null;
    if (this.g.state) { this.g.state.visited = this.g.state.visited || {}; this.g.state.visited[id] = true; }
    this.buildMinimap();
    this.actors.player = p;
    for (const n of m.npcs || []) {
      if (n.if && !this.g.check(n.if)) continue;
      const a = this.makeActor(n.id, this.g.lookOf(n.id));
      a.x = (n.at[0] + 0.5) * TS; a.y = (n.at[1] + 0.8) * TS; a.dir = n.dir || 'D'; a.npc = n;
      this.actors[n.id] = a;
    }
    this.firedTriggers = new Set();
    this.view().cam.x = p.x; this.view().cam.y = p.y;
    if (m.music) this.g.sound.play(m.music);
    this.g.onMapLoaded && this.g.onMapLoaded(m);
  }

  view() { return this.g.view; }

  makeActor(id, look) { return { id, look, frames: makePerson(look), x: 0, y: 0, dir: 'D', t: 0, moving: false, speed: 260, emote: null, visible: true }; }

  tileAt(x, y) {
    const c = Math.floor(x / TS), r = Math.floor(y / TS);
    if (r < 0 || c < 0 || r >= this.grid.length || c >= this.grid[0].length) return 'void';
    return this.grid[r][c];
  }

  solidAt(x, y, self) {
    for (const [dx, dy] of [[-14, -5], [14, -5], [-14, 6], [14, 6]]) if (SOLID.has(this.tileAt(x + dx, y + dy))) return true;
    for (const id in this.actors) {
      const a = this.actors[id];
      if (a === self || !a.visible || id === 'player' && self && self.id !== 'player') continue;
      if (self && self.id === 'player' && Math.hypot(a.x - x, (a.y - y) * 1.6) < 26) return true;
    }
    return false;
  }

  move(a, dx, dy) {
    if (!this.solidAt(a.x + dx, a.y, a)) a.x += dx;
    if (!this.solidAt(a.x, a.y + dy, a)) a.y += dy;
  }

  // ---------- 매 프레임 ----------
  update(dt) {
    const g = this.g, p = this.actors.player;
    this.fade += (this.fadeTo - this.fade) * Math.min(1, dt * 6);
    if (!this.map || !p) { if (this.cut) this.cut.update(dt); return; }
    for (const id in this.actors) {
      const a = this.actors[id];
      if (a.emote) { a.emote.t -= dt; if (a.emote.t <= 0) a.emote = null; }
      if (a.path) {
        const [tx, ty] = a.path, dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
        if (d < 4) { a.x = tx; a.y = ty; a.path = null; a.moving = false; }
        else {
          const sp = Math.min(d, a.speed * dt);
          if (Math.abs(dx) > 2) { a.x += Math.sign(dx) * Math.min(Math.abs(dx), sp); a.dir = dx > 0 ? 'R' : 'L'; }
          else { a.y += Math.sign(dy) * Math.min(Math.abs(dy), sp); a.dir = dy > 0 ? 'D' : 'U'; }
          a.moving = true; a.t += dt;
        }
      }
    }
    if (this.cut) this.cut.update(dt);
    else if (g.mode === 'world') this.control(dt);
    this.updateMobs(dt);
    const tgt = typeof this.camTarget === 'string' ? this.actors[this.camTarget] || p : { x: this.camTarget[0], y: this.camTarget[1] };
    this.follow(tgt, dt);
    this.flash = this.flash.filter((f) => (f.t -= dt) > 0);
  }

  control(dt) {
    const g = this.g, p = this.actors.player;
    const v = g.input.vec(), mag = Math.hypot(v[0], v[1]);
    if (p.knock) { this.move(p, p.knock[0] * dt, p.knock[1] * dt); p.knock[0] *= 0.85; p.knock[1] *= 0.85; if (Math.hypot(p.knock[0], p.knock[1]) < 20) p.knock = null; }
    if (mag > 0.15 && !p.path) {
      const sp = g.input.running() ? 352 : 224 * Math.min(1, 0.45 + mag);
      this.move(p, v[0] * sp * dt, v[1] * sp * dt);
      p.dir = Math.abs(v[0]) > Math.abs(v[1]) * 0.9 ? (v[0] > 0 ? 'R' : 'L') : v[1] > 0 ? 'D' : 'U';
      p.moving = true; p.t += dt * (sp / 224);
    } else if (!p.path) p.moving = false;
    // 가장자리: 옆 구역으로 이어짐
    const E = this.map.edges;
    if (E && !this.transit) {
      const c = Math.floor(p.x / TS), r = Math.floor((p.y - 10) / TS), cols = this.grid[0].length, rows = this.grid.length;
      const go = (e, sp, d) => { if (!e || (e.if && !g.check(e.if))) return false; this.goto(e.to, sp, d); return true; };
      if (p.x < TS * 0.55 && v[0] < -0.2 && go(E.W, [-1, r + (E.W && E.W.dc || 0)], 'L')) return;
      if (p.x > this.W - TS * 0.55 && v[0] > 0.2 && go(E.E, [0, r + (E.E && E.E.dc || 0)], 'R')) return;
      if (p.y < TS * 1.0 && v[1] < -0.2 && go(E.N, [c + (E.N && E.N.dc || 0), -1], 'U')) return;
      if (p.y > this.H - TS * 0.3 && v[1] > 0.2 && go(E.S, [c + (E.S && E.S.dc || 0), 0], 'D')) return;
    }
    // 문
    const here = this.tileAt(p.x, p.y - 10);
    if (here === 'door' || here === 'exit') {
      const c = Math.floor(p.x / TS), r = Math.floor((p.y - 10) / TS);
      const d = (this.map.doors || []).find((o) => o.at[0] === c && o.at[1] === r);
      if (d && !this.transit) {
        if (d.if && !g.check(d.if)) { if (!this.blocked) { this.blocked = true; g.toast(d.locked || '지금은 갈 수 없다'); p.y -= DIRV[p.dir][1] * 30; p.x -= DIRV[p.dir][0] * 30; setTimeout(() => (this.blocked = false), 800); } }
        else this.goto(d.to, d.spawn, d.dir);
      }
    }
    // 트리거
    for (const t of this.map.triggers || []) {
      if (t.if && !g.check(t.if)) continue;
      const key = t.id || t.scene;
      if (t.once !== false && (this.firedTriggers.has(key) || g.state.flags['trig_' + key])) continue;
      const [x, y, w, h] = t.rect;
      if (p.x > x * TS && p.x < (x + w) * TS && p.y > y * TS && p.y < (y + h) * TS) {
        this.firedTriggers.add(key); if (t.once !== false) g.state.flags['trig_' + key] = true;
        this.play(t.scene);
        return;
      }
    }
    this.prompt = this.findInteract();
  }

  findInteract() {
    const p = this.actors.player;
    const fx = p.x + DIRV[p.dir][0] * 40, fy = p.y + DIRV[p.dir][1] * 40 - 16;
    let best = null, bd = 96;
    for (const id in this.actors) {
      const a = this.actors[id];
      if (id === 'player' || !a.npc || !a.visible) continue;
      const d = Math.hypot(a.x - fx, a.y - 20 - fy);
      if (d < bd) { bd = d; best = { kind: 'npc', a, label: a.npc.label || '말 걸기', x: a.x, y: a.y - 104 }; }
    }
    for (const o of this.map.objects || []) {
      if (o.if && !this.g.check(o.if)) continue;
      const ox = (o.at[0] + 0.5) * TS, oy = (o.at[1] + 0.5) * TS;
      const d = Math.hypot(ox - fx, oy - fy);
      if (d < bd) { bd = d; best = { kind: 'obj', o, label: o.label || '조사', x: ox, y: oy - 60 }; }
    }
    return best;
  }

  interact() {
    const it = this.prompt; if (!it || this.cut) return;
    const p = this.actors.player;
    if (it.kind === 'npc') {
      const a = it.a;
      a.dir = Math.abs(p.x - a.x) > Math.abs(p.y - a.y) ? (p.x > a.x ? 'R' : 'L') : p.y > a.y ? 'D' : 'U';
      this.g.talkTo(a.npc, a);
    } else this.g.useObject(it.o);
  }

  async goto(mapId, spawn, dir) {
    this.transit = true;
    this.fadeTo = 1;
    await new Promise((r) => setTimeout(r, 300));
    await this.load(mapId, spawn, dir);
    this.fadeTo = 0;
    this.transit = false;
  }

  follow(t, dt) {
    const v = this.view(), c = v.cam;
    c.x += (t.x - c.x) * Math.min(1, dt * 6);
    c.y += (t.y - 40 - c.y) * Math.min(1, dt * 6);
    const hw = v.W / v.G / 2, hh = v.H / v.G / 2;
    c.x = this.W < hw * 2 ? this.W / 2 : Math.max(hw, Math.min(this.W - hw, c.x));
    c.y = this.H < hh * 2 ? this.H / 2 : Math.max(hh, Math.min(this.H - hh, c.y));
  }

  // ---------- 미니맵 ----------
  buildMinimap() {
    const rows = this.grid.length, cols = this.grid[0].length;
    const c = document.createElement('canvas'); c.width = cols; c.height = rows;
    const x = c.getContext('2d');
    const col = (t) => t === 'door' || t === 'exit' ? '#ffd23f' : t === 'water' ? '#3a78b8' : t === 'gate' ? '#b48cff' : SOLID.has(t) ? '#3a3236' : t === 'road' || t === 'lane' ? '#6a6d74' : t === 'grass' ? '#5aa63c' : '#b9b2a2';
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) { x.fillStyle = col(this.grid[r][k]); x.fillRect(k, r, 1, 1); }
    this.mini = c;
  }

  drawMinimap(x0, y0, maxW, maxH) {
    if (!this.mini || !this.map) return;
    const ctx = this.view().ctx, c = this.mini;
    const k = Math.min(maxW / c.width, maxH / c.height, 5);
    const w = c.width * k, h = c.height * k, x = x0 - w;
    ctx.globalAlpha = 0.85; ctx.fillStyle = 'rgba(20,16,12,0.8)'; ctx.fillRect(x - 4, y0 - 4, w + 8, h + 22);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(c, x, y0, w, h); ctx.globalAlpha = 1;
    ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 1.5; ctx.strokeRect(x - 4, y0 - 4, w + 8, h + 22);
    for (const id in this.actors) {
      const a = this.actors[id]; if (!a.visible) continue;
      ctx.fillStyle = id === 'player' ? '#ff4a4a' : '#ffffff';
      const r = id === 'player' ? 3 : 2;
      ctx.fillRect(x + a.x / TS * k - r / 2, y0 + (a.y - 10) / TS * k - r / 2, r, r);
    }
    ctx.fillStyle = '#f3e3b5'; ctx.font = '600 11px system-ui,sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(this.map.name, x0, y0 + h + 13); ctx.textAlign = 'left';
  }

  // ---------- 탈출 장면의 몬스터 ----------
  spawnMobs(list) {
    const M = this.g.A.monsters;
    for (const m of list) this.mobs.push({ x: (m.at[0] + 0.5) * TS, y: (m.at[1] + 0.8) * TS, kind: m.kind || 'slime_green', t: Math.random() * 3, speed: m.speed || 90, M: M[m.kind || 'slime_green'] });
  }

  updateMobs(dt) {
    const p = this.actors.player;
    for (const m of this.mobs) {
      m.t += dt;
      const dx = p.x - m.x, dy = p.y - m.y, d = Math.hypot(dx, dy) || 1;
      if (!this.cut && this.g.mode === 'world' && d < 420 && (m.t % 1.4) < 0.7) {
        const nx = m.x + dx / d * m.speed * dt, ny = m.y + dy / d * m.speed * dt;
        if (!SOLID.has(this.tileAt(nx, ny))) { m.x = nx; m.y = ny; }
      }
      if (!this.cut && d < 36 && !p.knock) { p.knock = [dx / d * 520, dy / d * 520]; this.g.sound.sfx('hurt'); this.view().addShake(4); this.flash.push({ t: 0.25 }); }
    }
  }

  // ---------- 컷신 ----------
  async play(id, onEnd) {
    const data = typeof id === 'string' ? await this.g.getJSON(`data/cutscenes/${id}.json`) : id;
    this.prompt = null;
    this.cut = new Cutscene(this, data.steps || data, () => { this.cut = null; this.camTarget = 'player'; onEnd && onEnd(); this.g.onCutsceneEnd && this.g.onCutsceneEnd(); });
    this.g.input.reset();
  }

  // ---------- 그리기 ----------
  draw() {
    if (!this.map) return;
    const v = this.view(), ctx = v.ctx;
    v.world();
    ctx.imageSmoothingEnabled = false;
    const hw = v.W / v.G / 2 + TS, hh = v.H / v.G / 2 + TS;
    const c0 = Math.max(0, Math.floor((v.cam.x - hw) / TS)), c1 = Math.min(this.grid[0].length - 1, Math.ceil((v.cam.x + hw) / TS));
    const r0 = Math.max(0, Math.floor((v.cam.y - hh) / TS)), r1 = Math.min(this.grid.length - 1, Math.ceil((v.cam.y + hh) / TS));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const t = this.tiles[this.grid[r][c]];
      if (t) ctx.drawImage(t, c * TS, r * TS, TS + 0.5, TS + 0.5);
    }
    for (const fx of this.map.glow || []) {
      const T = performance.now() / 1000, x = (fx[0] + 0.5) * TS, y = (fx[1] + 0.5) * TS;
      ctx.fillStyle = `rgba(150,110,255,${0.18 + Math.sin(T * 3) * 0.08})`; ctx.beginPath(); ctx.ellipse(x, y, 120, 60, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (this.g.portal) this.drawPortal(this.g.portal);
    const list = [];
    for (const id in this.actors) { const a = this.actors[id]; if (a.visible) list.push({ y: a.y, d: () => this.drawActor(a) }); }
    for (const m of this.mobs) list.push({ y: m.y, d: () => { const f = m.M.hop[Math.floor(m.t * 3) % m.M.hop.length]; v.shadow(m.x, m.y, 18); v.sprite(f, m.x, m.y, 0.34); } });
    list.sort((a, b) => a.y - b.y).forEach((o) => o.d());
    for (const id in this.actors) { const a = this.actors[id]; if (a.emote && a.visible) this.drawEmote(a); }
    if (this.prompt && !this.cut && this.g.mode === 'world') {
      const p = this.prompt;
      ctx.font = '700 22px system-ui,sans-serif'; ctx.textAlign = 'center';
      const w = ctx.measureText(p.label).width + 28;
      ctx.fillStyle = 'rgba(20,16,12,0.85)'; ctx.fillRect(p.x - w / 2, p.y - 22, w, 36);
      ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 2; ctx.strokeRect(p.x - w / 2, p.y - 22, w, 36);
      ctx.fillStyle = '#ffe9a8'; ctx.fillText(p.label, p.x, p.y + 4); ctx.textAlign = 'left';
    }
  }

  drawActor(a) {
    const v = this.view();
    const f = a.dir === 'L' ? a.frames.R : a.frames[a.dir];
    const step = a.moving ? [1, 0, 2, 0][Math.floor(a.t * 8) % 4] : 0;
    v.shadow(a.x, a.y, 17);
    v.sprite(f[step], a.x, a.y, PS, a.dir === 'L');
  }

  drawEmote(a) {
    const ctx = this.view().ctx, x = a.x, y = a.y - 108;
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#1a1420'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(x, y, 26, 22, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d8483f'; ctx.font = '900 26px system-ui'; ctx.textAlign = 'center'; ctx.fillText(a.emote.text, x, y + 9); ctx.textAlign = 'left';
  }

  drawPortal(pt) {
    const ctx = this.view().ctx, T = performance.now() / 1000, x = (pt[0] + 0.5) * TS, y = (pt[1] + 0.5) * TS;
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = `rgba(${150 + i * 25},70,255,${0.7 - i * 0.12})`; ctx.lineWidth = 6 - i;
      ctx.beginPath(); ctx.ellipse(x, y, 52 + i * 9 + Math.sin(T * 4 + i) * 5, 82 + i * 8, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(30,10,60,0.75)'; ctx.beginPath(); ctx.ellipse(x, y, 46, 76, 0, 0, Math.PI * 2); ctx.fill();
  }

  drawOverlay() {
    const v = this.view(), ctx = v.ctx;
    if (this.flash.length) { ctx.fillStyle = 'rgba(220,40,40,0.18)'; ctx.fillRect(0, 0, v.W, v.H); }
    if (this.fade > 0.01) { ctx.fillStyle = `rgba(0,0,0,${this.fade})`; ctx.fillRect(0, 0, v.W, v.H); }
    if (this.cut && this.cut.card) {
      const c = this.cut.card;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, v.W, v.H);
      ctx.fillStyle = '#f3e3b5'; ctx.font = '600 18px system-ui,sans-serif'; ctx.textAlign = 'center';
      ctx.globalAlpha = Math.min(1, c.t * 2, (c.dur - c.t) * 2);
      c.text.split('\n').forEach((l, i, arr) => ctx.fillText(l, v.W / 2, v.H / 2 + (i - (arr.length - 1) / 2) * 30));
      ctx.globalAlpha = 1; ctx.textAlign = 'left';
    }
  }
}

// ---------- 컷신 실행기 ----------
export class Cutscene {
  constructor(ow, steps, onEnd) { this.ow = ow; this.g = ow.g; this.steps = steps; this.i = -1; this.onEnd = onEnd; this.wait = 0; this.waitFor = null; this.card = null; this.next(); }

  next() {
    const g = this.g, ow = this.ow;
    while (true) {
      this.i++;
      if (this.i >= this.steps.length) { this.onEnd(); return; }
      const s = this.steps[this.i];
      if (s.if && !g.check(s.if)) continue;
      if (s.text !== undefined || s.say !== undefined) {
        const line = { speaker: s.say ? g.speakerName(s.say) : '', portrait: s.say ? g.portraitKey(s.say, s.portrait) : null, text: s.text || '', choices: s.choices, variants: s.variants };
        g.runLine(line, () => this.next());
        return;
      }
      if (s.move) { const a = ow.actors[s.move]; if (a) { a.path = [(s.to[0] + 0.5) * TS, (s.to[1] + 0.8) * TS]; if (s.speed) a.speed = s.speed; } if (s.nowait) continue; this.waitFor = () => !a || !a.path; return; }
      if (s.face) { const a = ow.actors[s.face]; if (a) a.dir = s.dir; continue; }
      if (s.wait) { this.wait = s.wait; return; }
      if (s.emote) { const a = ow.actors[s.emote]; if (a) a.emote = { text: s.mark || '!', t: s.t || 1.2 }; continue; }
      if (s.spawn) { const sp = s.spawn; const a = ow.makeActor(sp.id, g.lookOf(sp.look || sp.id)); a.x = (sp.at[0] + 0.5) * TS; a.y = (sp.at[1] + 0.8) * TS; a.dir = sp.dir || 'D'; if (sp.npc) a.npc = sp.npc; ow.actors[sp.id] = a; continue; }
      if (s.remove) { delete ow.actors[s.remove]; continue; }
      if (s.cam) { ow.camTarget = Array.isArray(s.cam) ? [(s.cam[0] + 0.5) * TS, (s.cam[1] + 0.5) * TS] : s.cam; continue; }
      if (s.fade) { ow.fadeTo = s.fade === 'out' ? 1 : 0; this.wait = 0.45; return; }
      if (s.card) { this.card = { text: g.fmt(s.card), t: 0, dur: s.dur || 3 }; return; }
      if (s.map) { ow.goto(s.map, s.at, s.dir).then(() => { ow.fadeTo = s.keepDark ? 1 : 0; this.next(); }); return; }
      if (s.music) { g.sound.play(s.music); continue; }
      if (s.stop) { g.sound.stopMusic(); continue; }
      if (s.sfx) { g.sound.sfx(s.sfx); continue; }
      if (s.shake) { g.view.addShake(s.shake); continue; }
      if (s.flag) { g.state.flags[s.flag] = true; continue; }
      if (s.objective !== undefined) { g.state.objective = s.objective; continue; }
      if (s.portal !== undefined) { g.portal = s.portal; continue; }
      if (s.mobs) { ow.spawnMobs(s.mobs); continue; }
      if (s.clearMobs) { ow.mobs = []; continue; }
      if (s.call) { const r = g.cutCall(s.call, s.arg, () => this.next()); if (r === 'async') return; continue; }
      if (s.end) { this.onEnd(); return; }
    }
  }

  update(dt) {
    if (this.card) { this.card.t += dt; if (this.card.t >= this.card.dur) { this.card = null; this.next(); } return; }
    if (this.wait > 0) { this.wait -= dt; if (this.wait <= 0) this.next(); return; }
    if (this.waitFor && this.waitFor()) { this.waitFor = null; this.next(); }
  }
}

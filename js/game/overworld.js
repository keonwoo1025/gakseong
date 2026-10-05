// 걸어 다니는 장소(집, 거리, 사무소 등)와 컷신.
// 지도는 data/town/*.json, 컷신은 data/cutscenes/*.json.
import { makePerson, makeTiles, SOLID } from './pixel.js';
import { Settings } from '../engine/settings.js';
import { frame as hudFrame } from './hud.js';
import { findPath } from './path.js';
import { framesFor, drawPerson } from './people.js';
import { Character, lying, drawWeapon } from './character.js';
import { TownFolk } from './townfolk.js';

export const TS = 96;   // 타일 한 칸: 16px 도트 x6 (탑 전투와 같은 크기 기준)
const K = TS / 64;      // 예전 64px 기준 수치 보정
const PS = 3.2 * K;     // 사람 도트 확대 배율 (키가 타일 약 1.3칸)
const CH = 130;         // 사람 키(월드 px), 탑 전투와 같다
const DIRV = { D: [0, 1], U: [0, -1], R: [1, 0], L: [-1, 0] };

export class Overworld {
  constructor(g) {
    this.g = g;
    this.map = null; this.actors = {}; this.tiles = {}; this.mobs = [];
    this.cut = null; this.fade = 0; this.fadeTo = 0; this.camTarget = 'player';
    this.prompt = null; this.flash = [];
    this.TS = TS; this.folk = new TownFolk(g, this);
  }

  // ---------- 지도 ----------
  async load(id, spawn, dir) {
    const m = await this.g.getJSON(`data/town/${id}.json`);
    this.map = m;
    this.tiles = makeTiles(m.theme);
    this.buildLayers(m);
    this.applyTownArt(m);
    this.W = this.grid[0].length * TS; this.H = this.grid.length * TS;
    this.actors = {};
    this.mobs = [];
    const p = this.g.townPlayer();
    const cols = this.grid[0].length, rows = this.grid.length;
    let at = (spawn || m.spawn || [1, 1]).slice();
    if (at[0] < 0) at[0] += cols; if (at[1] < 0) at[1] += rows;
    at[0] = Math.max(0, Math.min(cols - 1, at[0])); at[1] = Math.max(0, Math.min(rows - 1, at[1]));
    if (this.col[at[1]][at[0]] > 0) {
      let best = null;
      for (let d = 1; d < Math.max(cols, rows) && !best; d++) for (const [dx, dy] of [[0, d], [0, -d], [d, 0], [-d, 0]]) {
        const c = at[0] + dx, r = at[1] + dy;
        if (r >= 0 && c >= 0 && r < rows && c < cols && !this.col[r][c] && this.grid[r][c] !== 'door') { best = [c, r]; break; }
      }
      if (best) at = best;
    }
    p.x = (at[0] + 0.5) * TS; p.y = (at[1] + 0.8) * TS; p.dir = dir || p.dir || 'D'; p.path = null; p.route = null; p.knock = null; p.moving = false;
    if (this.g.state) { this.g.state.visited = this.g.state.visited || {}; this.g.state.visited[id] = true; }
    this.buildMinimap();
    this.actors.player = p;
    for (const n of m.npcs || []) {
      if (n.if && !this.g.check(n.if)) continue;
      if (this.g.state && this.g.state.deadNpc && this.g.state.deadNpc[n.id]) continue;
      if (n.hours && this.g.state && !n.hours.includes(this.g.state.time || 0)) continue;   // 일과: 이 시간대엔 없음
      const a = this.makeActor(n.id, this.g.lookOf(n.id));
      a.x = (n.at[0] + 0.5) * TS; a.y = (n.at[1] + 0.8) * TS; a.dir = n.dir || 'D'; a.npc = n;
      this.actors[n.id] = a;
    }
    if (this.g.state) this.folk.onLoad(m);
    this.firedTriggers = new Set();
    this.view().cam.x = p.x; this.view().cam.y = p.y;
    if (m.music) this.g.sound.play(m.music);
    this.g.onMapLoaded && this.g.onMapLoaded(m);
  }

  view() { return this.g.view; }

  makeActor(id, look) { const fr = framesFor(this.g, id, look); return Object.assign(new Character(id), { look, fr, frames: fr.P || makePerson(look), speed: 260 * K }); }

  // ---------- 맵 레이어 ----------
  // 바닥(ground 글자 지도) + 오브젝트(props 목록, data/objects.json 재사용) + 충돌(0 통행·1 막힘·2 물·3 낮은 막힘)
  // + 아이템(items) + 문·가장자리 이동(doors·edges) + NPC(npcs) + 이벤트(events)
  buildLayers(m) {
    const O = this.g.objects || { objects: {}, ground: {} };
    m.triggers = m.events || m.triggers || [];
    const rows = m.ground || m.rows;
    this.grid = rows.map((r) => [...r].map((ch) => m.legend[ch] || 'void'));
    this.prop = this.grid.map((r) => r.map((t) => (!m.ground && O.objects[t] ? t : null)));   // 옛 형식(rows)도 읽는다
    if (!m.ground) this.grid = this.grid.map((r) => r.map((t) => (O.objects[t] ? 'floor' : t)));
    for (const o of m.props || []) { const [x, y] = o.at; if (this.prop[y] && x < this.prop[y].length) this.prop[y][x] = o.obj; }
    this.col = this.grid.map((r, y) => r.map((t, x) => {
      const o = this.prop[y][x], oc = o ? ((O.objects[o] || {}).solid ?? 1) : 0;
      return Math.max(oc, O.ground[t] ?? 0);
    }));
    // 두 칸짜리 오브젝트(버스 정류장·노점 등)는 오른쪽 칸도 막는다
    for (const o of m.props || []) { const d = O.objects[o.obj]; if (d && d.span === 2 && this.col[o.at[1]] && o.at[0] + 1 < this.col[0].length) this.col[o.at[1]][o.at[0] + 1] = Math.max(this.col[o.at[1]][o.at[0] + 1], d.solid ?? 1); }
    if (m.collision) m.collision.forEach((r, y) => [...r].forEach((ch, x) => { if (ch >= '0' && ch <= '3' && this.col[y]) this.col[y][x] = Number(ch); }));
    const F = (this.g.state && this.g.state.flags) || {};
    this.items = (m.items || []).filter((it) => !F['item_' + it.key]);
  }

  tileAt(x, y) {
    const c = Math.floor(x / TS), r = Math.floor(y / TS);
    if (r < 0 || c < 0 || r >= this.grid.length || c >= this.grid[0].length) return 'void';
    return this.prop[r][c] || this.grid[r][c];
  }
  colAt(x, y) {
    const c = Math.floor(x / TS), r = Math.floor(y / TS);
    if (r < 0 || c < 0 || r >= this.grid.length || c >= this.grid[0].length) return 1;
    return this.col[r][c];
  }

  solidAt(x, y, self) {
    for (const [dx, dy] of [[-14 * K, -5 * K], [14 * K, -5 * K], [-14 * K, 6 * K], [14 * K, 6 * K]]) if (this.colAt(x + dx, y + dy) > 0) return true;
    for (const id in this.actors) {
      const a = this.actors[id];
      if (a === self || !a.visible || !a.alive || a.ko || id === 'player' && self && self.id !== 'player') continue;
      if (self && self.id === 'player' && Math.hypot(a.x - x, (a.y - y) * 1.6) < 26 * K) return true;
      if (self && self.folk && self.mood !== 'calm' && id === 'player' && Math.hypot(a.x - x, (a.y - y) * 1.6) < 22 * K) return true;
    }
    return false;
  }

  // 받은 타일 그림으로 교체 (없으면 코드 타일 유지). 물건 타일은 그 맵의 바닥 위에 얹는다.
  applyTownArt(m) {
    const T = this.g.A.ttiles; if (!T) return;
    const ok = (k) => T[k] && T[k].w && !T[k].missing;
    const out = !!(m.edges && Object.keys(m.edges).length);
    const fac = /factory/.test(m.id) && !out, tower = m.theme === 'porter' || m.theme === 'rift';
    const OBJ = new Set(['tree', 'fence', 'lamp', 'sign', 'bench', 'stall', 'crate', 'desk', 'chair', 'bed', 'shelf', 'counter', 'sofa', 'plant', 'fridge', 'board', 'screen', 'machine', 'belt', 'crate_m', 'pillar', 'planter', 'barrier', 'booth']);
    const map = out
      ? { walk: 'walk', road: 'road', lane: 'lane', grass: 'grass', sand: 'sand', water: 'water', wall: 'wall', window: 'window', door: 'door', floor: m.id === 'plaza' ? 'plaza' : 'walk', tree: 'planter', fence: 'barrier', crate: 'crate_m', pillar: 'pillar', plant: 'planter' }
      : tower ? { floor: 'plaza2', wall: 'wall_t', door: 'wall_t', pillar: 'pillar' }
      : fac ? { floor: 'floor_f', tile: 'floor_f', wall: 'wall_m', window: 'wall_m', door: 'door_m', exit: 'door_m', machine: 'machine', belt: 'belt', crate: 'crate_m', desk: 'desk', chair: 'chair', shelf: 'shelf', board: 'board', screen: 'screen', plant: 'plant' }
      : { wood: 'wood', tile: 'tile', rug: 'rug', floor: 'tile', wall: 'wall_in', window: 'window_in', door: 'door_in', exit: 'door_in', desk: 'desk', chair: 'chair', bed: 'bed', shelf: 'shelf', counter: 'counter', sofa: 'sofa', plant: 'plant', fridge: 'fridge', board: 'board', screen: 'screen', crate: 'crate_m' };
    // 새 마을 그림(town2): 바닥과 오브젝트. 오브젝트는 크기대로(키 큰 것·두 칸짜리) 캐릭터와 앞뒤 정렬해서 그린다
    const T2 = this.g.A.town2, ok2 = (k) => T2 && T2[k] && T2[k].w && !T2[k].missing;
    this.propArt = {};
    if (T2) for (const row of this.prop) for (const k of row) { const a = k && ((this.g.objects.objects[k] || {}).art || k); if (k && ok2(a)) this.propArt[k] = T2[a]; }
    const G2 = out ? { walk: 'walk', road: 'road', lane: 'lane', grass: 'grass', sand: 'sand', water: 'water', shore: 'shore_u', floor: m.id === 'plaza' ? 'plaza' : 'walk' } : {};
    for (const n of new Set(this.grid.flat())) if (G2[n] && ok2(G2[n])) { const c = document.createElement('canvas'); c.width = c.height = 64; c.getContext('2d').drawImage(T2[G2[n]].im, 0, 0, 64, 64); this.tiles[n] = c; }
    const used = new Set(this.grid.flat().concat(this.prop.flat().filter(Boolean)).filter((n) => !(G2[n] && ok2(G2[n])) && !this.propArt[n]));
    const baseName = out ? (m.id === 'plaza' ? 'floor' : 'walk') : ['wood', 'tile', 'floor'].find((k) => used.has(k)) || 'floor';
    const baseKey = map[baseName];
    // 위쪽 절반만 멀쩡한 바닥 그림(잘못 잘린 칸)은 위 절반을 두 번 이어 붙여 쓴다
    const HALF = { walk: 1, road: 1, sand: 1, water: 1 };
    const half = (k, k2) => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.drawImage(T[k].im, 0, 0, 64, 32, 0, 0, 64, 32); x.drawImage(T[k2 || k].im, 0, 0, 64, 32, 0, 32, 64, 32); return c; };
    const can = (k, under) => { if (HALF[k]) return half(k); if (k === 'lane') return half('lane', 'road'); const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); if (under) x.drawImage(under, 0, 0, 64, 64); const o = T[k]; x.drawImage(o.im, 0, 0, 64, 64); return c; };
    const base = ok(baseKey) ? can(baseKey) : this.tiles[baseName];
    for (const name of used) {
      const k = map[name]; if (!k || !ok(k)) continue;
      this.tiles[name] = can(k);
    }
    this.outdoor = out;
  }

  drawBuildings() {
    const B = this.g.A.bld, m = this.map; if (!B || !this.outdoor) return;
    const ok = (k) => B[k] && B[k].w && !B[k].missing, ctx = this.view().ctx;
    // 그림 속 문 위치(가로 비율)를 실제 문 칸에 맞춘다
    const DOOR = { apartment: 0.27, agency: 0.24, conv: 0.68, restaurant: 0.25, guild: 0.5, factory: 0.5, warehouse: 0.5 };
    const pick = { room: 'apartment', store: 'conv', office: 'agency', assoc: 'guild', hunter_shop: 'restaurant', factory_office: 'warehouse', factory_floor: 'warehouse' };
    let i = 0;
    for (const d of m.doors || []) {
      if (d.at[1] > this.grid.length / 2) continue;
      const k = pick[d.to] || (m.id === 'avenue' ? 'factory' : ['warehouse', 'restaurant'][i++ % 2]);
      if (!ok(k)) continue;
      const f = B[k], s = 4.4 * TS / f.w;
      ctx.drawImage(f.im, (d.at[0] + 0.5) * TS - f.w * s * (DOOR[k] || 0.5), (d.at[1] + 1) * TS - f.h * s, f.w * s, f.h * s);
    }
    if (ok('gate')) {
      let c0 = 1e9, c1 = -1, r1 = -1;
      this.grid.forEach((row, r) => row.forEach((t, c) => { if (t === 'gate') { c0 = Math.min(c0, c); c1 = Math.max(c1, c); r1 = Math.max(r1, r); } }));
      if (r1 >= 0) { const f = B.gate, w = (c1 - c0 + 5) * TS, s = w / f.w; ctx.drawImage(f.im, (c0 + c1 + 1) / 2 * TS - w / 2, (r1 + 1) * TS - f.h * s, w, f.h * s); }
    }
  }

  // 컷신 이동도 실제로 걸어서 장애물을 돌아간다
  routeTo(a, to) {
    const cols = this.grid[0].length, rows = this.grid.length;
    const sc = Math.floor(a.x / TS), sr = Math.floor((a.y - 15) / TS);
    const p = findPath(cols, rows, (c, r) => this.col[r][c] > 0, sc, sr, to[0], to[1], 3000);
    if (!p || p.length < 3) return null;
    // 경로 펴기: 직선으로 갈 수 있는 칸은 건너뛰어 지그재그(빙글빙글 도는 문제)를 없앤다
    const los = (a1, b1) => { const n = Math.ceil(Math.hypot(b1[0] - a1[0], b1[1] - a1[1]) * 4); for (let i = 1; i < n; i++) { const t = i / n, x = a1[0] + (b1[0] - a1[0]) * t + 0.5, y = a1[1] + (b1[1] - a1[1]) * t + 0.5; for (const [ox, oy] of [[-0.3, 0], [0.3, 0], [0, -0.2], [0, 0.2]]) { const c = Math.floor(x + ox), r = Math.floor(y + oy); if (!this.col[r] || this.col[r][c] > 0) return false; } } return true; };
    const out = [p[0]]; let i = 0;
    while (i < p.length - 1) { let j = p.length - 1; while (j > i + 1 && !los(p[i], p[j])) j--; out.push(p[j]); i = j; }
    if (out.length < 2) return null;
    return out.slice(1, -1).concat([p[p.length - 1]]).slice(0, -1).map(([c, r]) => [(c + 0.5) * TS, (r + 0.8) * TS]);
  }

  unstick(a) {
    if (!this.solidAt(a.x, a.y, a)) return;
    for (let d = 12; d < TS * 6; d += 12) {
      for (let k = 0; k < 16; k++) {
        const an = k / 16 * Math.PI * 2, x = a.x + Math.cos(an) * d, y = a.y + Math.sin(an) * d;
        if (!this.solidAt(x, y, a) && this.tileAt(x, y - 15) !== 'door') { a.x = x; a.y = y; return; }
      }
    }
  }

  move(a, dx, dy) {
    if (this.solidAt(a.x, a.y, a)) { this.unstick(a); return; }
    const x0 = a.x, y0 = a.y;
    if (!this.solidAt(a.x + dx, a.y, a)) a.x += dx;
    if (!this.solidAt(a.x, a.y + dy, a)) a.y += dy;
    // 모서리에 걸리면 옆으로 미끄러져 비켜 간다
    if (a.x === x0 && a.y === y0 && (dx || dy)) {
      const L = Math.hypot(dx, dy), px = -dy / L * L, py = dx / L * L;
      for (const k of [1, -1]) { if (!this.solidAt(a.x + px * k * 0.7 + dx * 0.3, a.y + py * k * 0.7 + dy * 0.3, a)) { a.x += px * k * 0.7 + dx * 0.3; a.y += py * k * 0.7 + dy * 0.3; break; } }
    }
  }

  // ---------- 매 프레임 ----------
  update(dt) {
    const g = this.g, p = this.actors.player;
    this.fade += (this.fadeTo - this.fade) * Math.min(1, dt * 6);
    if (!this.map || !p) { if (this.cut) this.cut.update(dt); return; }
    for (const id in this.actors) {
      const a = this.actors[id];
      if (a.emote) { a.emote.t -= dt; if (a.emote.t <= 0) a.emote = null; }
      if (a.route && a.route.length) {
        const [tx, ty] = a.route[0], dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
        if (d < 4) { a.x = tx; a.y = ty; a.route.shift(); }
        else { const sp = Math.min(d, a.speed * dt); a.x += dx / d * sp; a.y += dy / d * sp; a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : dy > 0 ? 'D' : 'U'; a.moving = true; a.t += dt; }
      } else if (a.path) {
        const [tx, ty] = a.path, dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
        if (d < 4) { a.x = tx; a.y = ty; a.path = null; a.moving = false; if (a.isPlayer) a.state = 'idle'; }
        else {
          const sp = Math.min(d, a.speed * dt);
          if (Math.abs(dx) > 2) { a.x += Math.sign(dx) * Math.min(Math.abs(dx), sp); a.dir = dx > 0 ? 'R' : 'L'; }
          else { a.y += Math.sign(dy) * Math.min(Math.abs(dy), sp); a.dir = dy > 0 ? 'D' : 'U'; }
          a.moving = true; a.t += dt;
        }
      }
      if (a.isPlayer && (a.path || (a.route && a.route.length))) { a.state = 'walk'; a.running = false; a.wf += a.speed * dt; }
    }
    if (this.cut) this.cut.update(dt);
    else if (g.mode === 'world') this.control(dt);
    this.updateMobs(dt);
    if (!this.cut) this.folk.update(dt);
    const CB = this.cutBoss; if (CB) { CB.atk = Math.max(0, CB.atk - dt); if (CB.tx != null) { const dx = CB.tx - CB.x, dy = CB.ty - CB.y, d = Math.hypot(dx, dy); if (d > 4) { const k = Math.min(1, dt * 900 / d); CB.x += dx * k; CB.y += dy * k; if (Math.abs(dx) > 2) CB.dir = dx < 0 ? -1 : 1; } } }
    const tgt = typeof this.camTarget === 'string' ? this.actors[this.camTarget] || p : { x: this.camTarget[0], y: this.camTarget[1] };
    this.follow(tgt, dt);
    this.flash = this.flash.filter((f) => (f.t -= dt) > 0);
  }

  control(dt) {
    const g = this.g, p = this.actors.player;
    this.unstick(p);
    const v = g.input.vec();
    if (p.knock) { this.move(p, p.knock[0] * dt, p.knock[1] * dt); p.knock[0] *= 0.85; p.knock[1] *= 0.85; if (Math.hypot(p.knock[0], p.knock[1]) < 20 * K) p.knock = null; }
    // 마을에서도 탑과 같은 주인공 조작 (이동·달리기·공격·회피·스킬)
    if (!p.path && !(p.route && p.route.length)) { p.update(dt); p.moving = p.state === 'walk'; }
    if (p.state === 'dead') return;
    // 가장자리: 옆 구역으로 이어짐
    const E = this.map.edges;
    if (E && !this.transit) {
      const c = Math.floor(p.x / TS), r = Math.floor((p.y - 15) / TS), cols = this.grid[0].length, rows = this.grid.length;
      const go = (e, sp, d) => { if (!e || (e.if && !g.check(e.if))) return false; this.goto(e.to, sp, d); return true; };
      if (p.x < TS * 0.55 && v[0] < -0.2 && go(E.W, [-1, r + (E.W && E.W.dc || 0)], 'L')) return;
      if (p.x > this.W - TS * 0.55 && v[0] > 0.2 && go(E.E, [0, r + (E.E && E.E.dc || 0)], 'R')) return;
      if (p.y < TS * 1.0 && v[1] < -0.2 && go(E.N, [c + (E.N && E.N.dc || 0), -1], 'U')) return;
      if (p.y > this.H - TS * 0.3 && v[1] > 0.2 && go(E.S, [c + (E.S && E.S.dc || 0), 0], 'D')) return;
    }
    // 문
    const here = this.tileAt(p.x, p.y - 15);
    if (here === 'door' || here === 'exit') {
      const c = Math.floor(p.x / TS), r = Math.floor((p.y - 15) / TS);
      const d = (this.map.doors || []).find((o) => o.at[0] === c && o.at[1] === r);
      const shut = !d || (d.if && !g.check(d.if));
      if (shut && !this.blocked && !this.transit) {
        this.blocked = true; p.state = 'idle';
        const back = () => { p.path = [p.x - DIRV[p.dir][0] * TS * 0.9, p.y - DIRV[p.dir][1] * TS * 0.9 + (DIRV[p.dir][1] < 0 ? TS * 0.3 : 0)]; setTimeout(() => (this.blocked = false), 900); };
        g.runLine({ text: (d && d.locked) || '문이 잠겨 있다.' }, back);
      } else if (d && !shut && !this.transit) this.goto(d.to, d.spawn, d.dir);
    }
    // 밟기 트리거 (이벤트 DB)
    if (g.events.fire('step', { c: Math.floor(p.x / TS), r: Math.floor((p.y - 15) / TS) })) return;
    g.events.update(dt);
    this.prompt = this.findInteract();
  }

  findInteract() {
    const p = this.actors.player;
    const fx = p.x + DIRV[p.dir][0] * 60, fy = p.y + DIRV[p.dir][1] * 60 - 24;
    let best = null, bd = 144;
    for (const id in this.actors) {
      const a = this.actors[id];
      if (id === 'player' || !a.npc || !a.visible || !a.alive || a.ko) continue;
      const d = Math.hypot(a.x - fx, a.y - 30 - fy);
      if (d < bd) { bd = d; best = { kind: 'npc', a, label: a.npc.label || '말 걸기', x: a.x, y: a.y - 156 }; }
    }
    for (const it of this.items || []) {
      const ox = (it.at[0] + 0.5) * TS, oy = (it.at[1] + 0.5) * TS, d = Math.hypot(ox - fx, oy - fy);
      if (d < bd) { bd = d; best = { kind: 'item', it, label: '줍기', x: ox, y: oy - 70 }; }
    }
    for (const o of this.map.objects || []) {
      if (o.if && !this.g.check(o.if)) continue;
      const ox = (o.at[0] + 0.5) * TS, oy = (o.at[1] + 0.5) * TS;
      const d = Math.hypot(ox - fx, oy - fy);
      if (d < bd) { bd = d; best = { kind: 'obj', o, label: o.label || '조사', x: ox, y: oy - 90 }; }
    }
    return best;
  }

  interact() {
    const it = this.prompt; if (!it || this.cut) return;
    const p = this.actors.player;
    if (it.kind === 'npc') {
      const a = it.a;
      if (this.folk.talkBlocked(a)) return;
      a.dir = Math.abs(p.x - a.x) > Math.abs(p.y - a.y) ? (p.x > a.x ? 'R' : 'L') : p.y > a.y ? 'D' : 'U';
      this.g.talkTo(a.npc, a);
    } else if (it.kind === 'item') this.pickItem(it.it);
    else this.g.useObject(it.o);
  }

  // 맵에 놓인 아이템: 한 번 주우면 다시 생기지 않는다 (key로 기록)
  pickItem(it) {
    const g = this.g, s = g.state, def = g.items[it.id]; if (!def) return;
    if (g.gear.isGear(it.id)) g.gear.give(it.id); else s.inv[it.id] = (s.inv[it.id] || 0) + (it.n || 1);
    s.flags['item_' + it.key] = true;
    this.items = this.items.filter((x) => x !== it);
    g.onItem(it.id);
    g.sound.sfx('select'); g.toast(`${def.name}${(it.n || 1) > 1 ? ' ×' + it.n : ''}을(를) 주웠다`);
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
    c.y += (t.y - 60 - c.y) * Math.min(1, dt * 6);
    const hw = v.W / v.G / 2, hh = v.H / v.G / 2;
    c.x = this.W < hw * 2 ? this.W / 2 : Math.max(hw, Math.min(this.W - hw, c.x));
    c.y = this.H < hh * 2 ? this.H / 2 : Math.max(hh, Math.min(this.H - hh, c.y));
  }

  // ---------- 목표 안내 ----------
  guidePoint() {
    const g = this.g, t = g.state && g.state.objTarget; if (!t || !this.map) return null;
    const cur = this.map.id, cm = g.citymap;
    const nodeOf = (id) => cm.nodes.find((n) => n.id === id || (n.inside || []).includes(id));
    if (cur === t.map) return [(t.at[0] + 0.5) * TS, (t.at[1] + 0.5) * TS];
    const here = cm.nodes.find((n) => n.id === cur);
    if (!here) { const d = (this.map.doors || [])[0]; return d ? [(d.at[0] + 0.5) * TS, (d.at[1] + 0.5) * TS] : null; }
    const goal = nodeOf(t.map); if (!goal) return null;
    if (goal.id === cur) { const d = (this.map.doors || []).find((o) => o.to === t.map); return d ? [(d.at[0] + 0.5) * TS, (d.at[1] + 0.5) * TS] : null; }
    const prev = { [cur]: null }, q = [cur];
    while (q.length) { const x = q.shift(); if (x === goal.id) break; for (const [a, b] of cm.links) { const y = a === x ? b : b === x ? a : null; if (y && !(y in prev)) { prev[y] = x; q.push(y); } } }
    if (!(goal.id in prev)) return null;
    let step = goal.id; while (prev[step] !== cur && prev[step] !== null) step = prev[step];
    const E = this.map.edges || {};
    for (const k in E) if (E[k].to === step) {
      const p = this.actors.player;
      if (k === 'E') return [this.W, p.y]; if (k === 'W') return [0, p.y]; if (k === 'N') return [p.x, 0]; if (k === 'S') return [p.x, this.H];
    }
    return null;
  }

  drawGuide() {
    const pt = this.guidePoint(), p = this.actors.player; if (!pt || !p || this.cut) return;
    const dx = pt[0] - p.x, dy = pt[1] - (p.y - 60), d = Math.hypot(dx, dy); if (d < 105) return;
    const ctx = this.view().ctx, a = Math.atan2(dy, dx), T = performance.now() / 1000, r = 105 + Math.sin(T * 5) * 9;
    const sys = this.g.awakened && this.g.state && this.g.awakened();
    ctx.save(); ctx.translate(p.x + Math.cos(a) * r, p.y - 60 + Math.sin(a) * r); ctx.rotate(a); ctx.scale(K, K);
    ctx.fillStyle = sys ? 'rgba(127,216,255,0.9)' : 'rgba(255,200,90,0.92)'; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-8, -12); ctx.lineTo(-3, 0); ctx.lineTo(-8, 12); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.restore();
  }

  // ---------- 미니맵 ----------
  buildMinimap() {
    const rows = this.grid.length, cols = this.grid[0].length;
    const c = document.createElement('canvas'); c.width = cols; c.height = rows;
    const x = c.getContext('2d');
    const col = (t, c) => t === 'door' || t === 'exit' ? '#ffd23f' : t === 'water' ? '#3a78b8' : t === 'gate' ? '#b48cff' : c ? '#3a3236' : t === 'road' || t === 'lane' ? '#6a6d74' : t === 'grass' ? '#5aa63c' : '#b9b2a2';
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) { x.fillStyle = col(this.grid[r][k], this.col[r][k]); x.fillRect(k, r, 1, 1); }
    this.mini = c;
  }

  drawMinimap(x0, y0, maxW, maxH) {
    if (!this.mini || !this.map) return;
    const ctx = this.view().ctx, c = this.mini;
    const k = Math.min(maxW / c.width, maxH / c.height, 5);
    const w = c.width * k, h = c.height * k, x = x0 - w;
    const T = this.g.hud.T();
    hudFrame(ctx, x - 4, y0 - 4, w + 8, h + 22, T);
    ctx.globalAlpha = 0.9; ctx.imageSmoothingEnabled = false; ctx.drawImage(c, x, y0, w, h); ctx.globalAlpha = 1;
    for (const id in this.actors) {
      const a = this.actors[id]; if (!a.visible || !a.alive) continue;
      ctx.fillStyle = id === 'player' ? '#ff4a4a' : a.mood === 'fight' ? '#ff9a3a' : '#ffffff';
      const r = id === 'player' ? 3 : 2;
      ctx.fillRect(x + a.x / TS * k - r / 2, y0 + (a.y - 15) / TS * k - r / 2, r, r);
    }
    const gp = this.guidePoint();
    if (gp && this.g.state.objTarget && this.g.state.objTarget.map === this.map.id) { ctx.fillStyle = Math.floor(performance.now() / 300) % 2 ? '#ffd23f' : '#ff8a3a'; ctx.beginPath(); ctx.arc(x + gp[0] / TS * k, y0 + gp[1] / TS * k, 3.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = T.text; ctx.font = '600 11px system-ui,sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(this.map.name, x0, y0 + h + 13); ctx.textAlign = 'left';
  }

  // ---------- 탈출 장면의 몬스터 ----------
  spawnMobs(list) {
    const M = this.g.A.monsters;
    for (const m of list) this.mobs.push({ x: (m.at[0] + 0.5) * TS, y: (m.at[1] + 0.8) * TS, kind: m.kind || 'slime_green', t: Math.random() * 3, speed: (m.speed || 90) * K, M: M[m.kind || 'slime_green'] });
  }

  updateMobs(dt) {
    const p = this.actors.player;
    for (const m of this.mobs) {
      m.t += dt;
      const dx = p.x - m.x, dy = p.y - m.y, d = Math.hypot(dx, dy) || 1;
      if (!this.cut && this.g.mode === 'world' && d < 420 * K && (m.t % 1.4) < 0.7) {
        const nx = m.x + dx / d * m.speed * dt, ny = m.y + dy / d * m.speed * dt;
        if (!this.colAt(nx, ny)) { m.x = nx; m.y = ny; }
      }
      if (!this.cut && d < 36 * K && !p.knock) { p.knock = [dx / d * 520 * K, dy / d * 520 * K]; this.g.sound.sfx('hurt'); this.view().addShake(4); this.flash.push({ t: 0.25 }); }
    }
  }

  // ---------- 컷신 ----------
  async play(id, onEnd) {
    const data = typeof id === 'string' ? await this.g.getJSON(`data/events/${id}.json`) : id;
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
      const pr = this.prop[r][c] && !(this.propArt && this.propArt[this.prop[r][c]]) && this.tiles[this.prop[r][c]];
      if (pr) ctx.drawImage(pr, c * TS, r * TS, TS + 0.5, TS + 0.5);
    }
    for (const it of this.items || []) {
      const T = performance.now() / 1000, x = (it.at[0] + 0.5) * TS, y = (it.at[1] + 0.6) * TS + Math.sin(T * 3) * 4;
      const ic = this.g.A.ui && this.g.A.ui['item_' + it.id];
      v.shadow(x, (it.at[1] + 0.75) * TS, 16);
      if (ic && ic.w && !ic.missing) ctx.drawImage(ic.im, x - 20, y - 20, 40, 40);
      else { ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#1a1420'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      ctx.fillStyle = `rgba(255,255,255,${0.5 + Math.sin(T * 6) * 0.4})`; ctx.fillRect(x + 12, y - 18, 4, 4);
    }
    for (const fx of this.map.glow || []) {
      const T = performance.now() / 1000, x = (fx[0] + 0.5) * TS, y = (fx[1] + 0.5) * TS;
      ctx.fillStyle = `rgba(150,110,255,${0.18 + Math.sin(T * 3) * 0.08})`; ctx.beginPath(); ctx.ellipse(x, y, 120 * K, 60 * K, 0, 0, Math.PI * 2); ctx.fill();
    }
    this.drawBuildings();
    for (const dc of this.map.decals || []) {
      const T = this.g.A.ttiles, f = T && T[dc.art]; const x = (dc.at[0] + 0.5) * TS, y = (dc.at[1] + 0.5) * TS, w = TS * 3;
      ctx.save(); ctx.globalAlpha = this.runeOn ? 0.75 + Math.sin(performance.now() / 120) * 0.25 : 0.25;
      if (this.runeOn) ctx.filter = 'sepia(1) saturate(8) hue-rotate(-40deg)';
      if (f && f.w) ctx.drawImage(f.im, x - w / 2, y - w / 2, w, w); ctx.restore();
    }
    if (this.g.portal) this.drawPortal(this.g.portal);
    if (this.g.fx) this.g.fx.draw(true);
    const list = [];
    if (this.propArt) {
      const v0 = this.view(), cx0 = Math.max(0, Math.floor((v0.cam.x - v0.W / v0.G / 2) / TS) - 2), cx1 = Math.min(this.grid[0].length - 1, Math.ceil((v0.cam.x + v0.W / v0.G / 2) / TS) + 2);
      const cy0 = Math.max(0, Math.floor((v0.cam.y - v0.H / v0.G / 2) / TS) - 1), cy1 = Math.min(this.grid.length - 1, Math.ceil((v0.cam.y + v0.H / v0.G / 2) / TS) + 3);
      for (let r = cy0; r <= cy1; r++) for (let c = cx0; c <= cx1; c++) {
        const f = this.prop[r][c] && this.propArt[this.prop[r][c]]; if (!f) continue;
        const w = f.w / 64 * TS, h = f.h / 64 * TS, x = w > TS * 1.5 ? c * TS : c * TS + (TS - w) / 2, y = (r + 1) * TS - h;
        list.push({ y: (r + 1) * TS - 2, d: () => ctx.drawImage(f.im, x, y, w, h) });
      }
    }
    for (const id in this.actors) {
      const a = this.actors[id]; if (!a.visible) continue;
      if (a.isPlayer && this.cutBoss && !list.boss) { list.boss = 1; const B = this.cutBoss; list.push({ y: B.y, d: () => this.drawCutBoss(B) }); }
      if (a.isPlayer) { if (this.cut || a.path || (a.route && a.route.length)) { if (a.state === 'attack' || a.state === 'dodge' || a.state === 'dash') a.state = 'idle'; } a.collect(list); continue; }
      list.push({ y: a.y, d: () => this.drawActor(a) });
    }
    for (const m of this.mobs) list.push({ y: m.y, d: () => { const f = m.M.hop[Math.floor(m.t * 3) % m.M.hop.length]; v.shadow(m.x, m.y, 18 * K); v.sprite(f, m.x, m.y, 0.34 * K); } });
    list.sort((a, b) => a.y - b.y).forEach((o) => o.d());
    for (const id in this.actors) { const a = this.actors[id]; if (a.emote && a.visible) this.drawEmote(a); if (a.say && a.visible) this.drawSay(a); if (a.npc && a.visible && a.alive && !a.ko && !a.say && !this.cut) { const mk = this.g.quests.mark(id); if (mk) this.drawMark(a, mk); } }
    if (this.g.sk && this.g.awakened && this.g.state && this.g.awakened()) this.g.sk.draw();
    if (this.g.mode === 'world' && !this.g.talking) this.drawGuide();
    if (this.prompt && !this.cut && this.g.mode === 'world' && this.g.actTarget()) {
      const p = this.prompt;
      ctx.font = '700 30px system-ui,sans-serif'; ctx.textAlign = 'center';
      const w = ctx.measureText(p.label).width + 36;
      const T = this.g.hud.T(); hudFrame(ctx, p.x - w / 2, p.y - 30, w, 48, T);
      ctx.fillStyle = T.text; ctx.fillText(p.label, p.x, p.y + 5); ctx.textAlign = 'left';
    }
  }

  drawActor(a) {
    const v = this.view(), ctx = v.ctx;
    if (!a.alive || a.ko || a.downed) {
      const k = a.alive ? 1 : Math.min(1, (2.2 - a.dead) * 4), al = a.alive ? 1 : Math.min(1, a.dead);
      lying(ctx, a, () => drawPerson(v, { ...a, moving: false }, CH, al, PS), k);
      if (a.ko) { ctx.fillStyle = '#ffe9a8'; ctx.font = '700 22px system-ui'; ctx.textAlign = 'center'; ctx.fillText('✦ ✦', a.x, a.y - 40); ctx.textAlign = 'left'; }
      return;
    }
    let ox = 0;
    if (a.st === 'wind' && Math.floor(a.stt * 14) % 2 === 0) ctx.filter = 'sepia(1) saturate(6) hue-rotate(-40deg) brightness(1.1)';
    if (a.hit > 0) { ctx.filter = 'brightness(2.4)'; ox = (Math.random() - 0.5) * 6; }
    // 공격 모션: 준비 때 뒤로 젖히고, 공격 때 앞으로 내딛으며 휘두른다
    const DVv = { D: [0, 1], U: [0, -1], R: [1, 0], L: [-1, 0] }[a.dir] || [0, 1], base = { D: Math.PI / 2, U: -Math.PI / 2, R: 0, L: Math.PI }[a.dir] || 0;
    const lean = a.st === 'wind' ? -7 : a.st === 'atk' ? 12 : 0;
    a.swing = a.st === 'wind' ? base - 1.8 : a.st === 'atk' ? base + 0.6 : null;
    const w = a.equip && a.equip.weapon, ch = ox || lean ? { ...a, x: a.x + ox + DVv[0] * lean, y: a.y + DVv[1] * lean } : a;
    if (a.st === 'atk' && !w) { ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(ch.x + DVv[0] * 40, ch.y - 60 + DVv[1] * 20, 26, base - 1, base + 1); ctx.stroke(); ctx.restore(); }
    if (w) drawWeapon(this.g, ctx, ch, w, CH, true);
    drawPerson(v, ch, CH, 1, PS);
    if (w) drawWeapon(this.g, ctx, ch, w, CH, false);
    ctx.filter = 'none';
    if (a.folk && a.hp < a.d.hp) {
      const top = a.y - CH - 14;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(a.x - 36, top, 72, 8);
      ctx.fillStyle = '#e8433f'; ctx.fillRect(a.x - 35, top + 1, 70 * Math.max(0, a.hp / a.d.hp), 6);
    }
  }

  // 퀘스트 표시: 받을 수 있으면 ?, 보고할 수 있으면 !
  drawMark(a, m) {
    const ctx = this.view().ctx, T = performance.now() / 1000, x = a.x, y = a.y - CH - 36 + Math.sin(T * 4) * 5;
    ctx.font = '900 44px system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 6; ctx.strokeStyle = '#1a1420';
    ctx.fillStyle = m === '!' ? '#ffd23f' : '#7fd8ff'; ctx.strokeText(m, x, y); ctx.fillText(m, x, y); ctx.textAlign = 'left';
  }

  drawCutBoss(B) {
    const M = this.g.A.mobs && this.g.A.mobs[B.kind]; if (!M) return;
    const T = performance.now() / 1000, arr = B.atk > 0 && M.atk && M.atk.length ? M.atk : M.move && M.move.length ? M.move : M.idle;
    const f = arr[Math.floor(T * 8) % arr.length]; const v = this.view();
    v.shadow(B.x, B.y, 60 * B.s);
    v.ctx.filter = 'brightness(0.55) sepia(1) saturate(4) hue-rotate(-30deg)'; v.sprite(f, B.x, B.y, B.s, B.dir < 0); v.ctx.filter = 'none';
  }

  drawSay(a) {
    const ctx = this.view().ctx, t = a.say.text;
    ctx.font = '600 24px system-ui,sans-serif'; ctx.textAlign = 'center';
    const w = Math.min(520, ctx.measureText(t).width + 28), x = a.x, y = a.y - CH - 50;
    ctx.globalAlpha = Math.min(1, a.say.t * 3);
    ctx.fillStyle = 'rgba(255,255,255,0.94)'; ctx.strokeStyle = '#1a1420'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - w / 2, y - 26, w, 40, 10) : ctx.rect(x - w / 2, y - 26, w, 40); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#1a1420'; ctx.fillText(t, x, y + 2); ctx.textAlign = 'left'; ctx.globalAlpha = 1;
  }

  drawEmote(a) {
    const ctx = this.view().ctx, x = a.x, y = a.y - 162;
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#1a1420'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(x, y, 39, 33, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d8483f'; ctx.font = '900 39px system-ui'; ctx.textAlign = 'center'; ctx.fillText(a.emote.text, x, y + 13); ctx.textAlign = 'left';
  }

  drawPortal(pt) {
    const ctx = this.view().ctx, T = performance.now() / 1000, x = (pt[0] + 0.5) * TS, y = (pt[1] + 0.5) * TS;
    const art = this.g.A.tower2 && this.g.A.tower2.portal;
    if (art && art.w && !art.missing) {   // 포탈(게이트): 보랏빛으로 맥동
      const k = 1 + Math.sin(T * 3) * 0.06; ctx.save(); ctx.filter = 'hue-rotate(70deg) saturate(1.6)'; ctx.globalAlpha = 0.9;
      ctx.drawImage(art.im, x - TS * 1.3 * k, y - TS * 0.8 * k, TS * 2.6 * k, TS * 1.6 * k); ctx.restore();
      ctx.fillStyle = 'rgba(40,0,70,0.55)'; ctx.beginPath(); ctx.ellipse(x, y, TS * 0.7, TS * 0.35, 0, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = `rgba(${150 + i * 25},70,255,${0.7 - i * 0.12})`; ctx.lineWidth = 6 - i;
      ctx.beginPath(); ctx.ellipse(x, y, (52 + i * 9 + Math.sin(T * 4 + i) * 5) * K, (82 + i * 8) * K, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(30,10,60,0.75)'; ctx.beginPath(); ctx.ellipse(x, y, 46 * K, 76 * K, 0, 0, Math.PI * 2); ctx.fill();
  }

  drawOverlay() {
    const v = this.view(), ctx = v.ctx;
    // 시간대: 저녁은 주황빛, 밤은 어둡게 (실내는 약하게)
    const tm = this.g.state ? this.g.state.time || 0 : 0;
    if (tm >= 2 && this.map && this.map.id !== 'rift') { ctx.fillStyle = tm === 2 ? `rgba(255,120,40,${this.outdoor ? 0.13 : 0.06})` : `rgba(10,20,60,${this.outdoor ? 0.42 : 0.16})`; ctx.fillRect(0, 0, v.W, v.H); }
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
      if (s.move) { const a = ow.actors[s.move]; if (a) { a.path = [(s.to[0] + 0.5) * TS, (s.to[1] + 0.8) * TS]; if (s.speed) a.speed = s.speed * K; a.route = ow.routeTo(a, s.to); } if (s.nowait) continue; this.waitFor = () => !a || (!a.path && !(a.route && a.route.length)); return; }
      if (s.face) { const a = ow.actors[s.face]; if (a) a.dir = s.dir; continue; }
      if (s.wait) { this.wait = s.wait; return; }
      if (s.emote) { const a = ow.actors[s.emote]; if (a) a.emote = { text: s.mark || '!', t: s.t || 1.2 }; continue; }
      if (s.spawn) { const sp = s.spawn; const a = ow.makeActor(sp.id, g.lookOf(sp.look || sp.id)); a.x = (sp.at[0] + 0.5) * TS; a.y = (sp.at[1] + 0.8) * TS; a.dir = sp.dir || 'D'; if (sp.npc) a.npc = sp.npc; ow.actors[sp.id] = a; if (sp.npc) ow.folk.arm(a, { rank: (g.npcById[sp.id] || {}).rank, name: g.npcName(sp.id), personality: ow.folk.personalityOf(sp.id) || '과묵한 고독자' }); continue; }
      if (s.remove) { delete ow.actors[s.remove]; continue; }
      if (s.cam) { ow.camTarget = Array.isArray(s.cam) ? [(s.cam[0] + 0.5) * TS, (s.cam[1] + 0.5) * TS] : s.cam; continue; }
      if (s.fade) { ow.fadeTo = s.fade === 'out' ? 1 : 0; this.wait = 0.45; return; }
      if (s.card) { this.card = { text: g.fmt(s.card), t: 0, dur: s.dur || 3 }; return; }
      if (s.map) { ow.goto(s.map, s.at, s.dir).then(() => { ow.fadeTo = s.keepDark ? 1 : 0; this.next(); }); return; }
      if (s.music) { g.sound.play(s.music); continue; }
      if (s.stop) { g.sound.stopMusic(); continue; }
      if (s.sfx) { g.sound.sfx(s.sfx); continue; }
      if (s.shake) { g.view.addShake(s.shake); continue; }
      if (s.fall) { const a = ow.actors[s.fall]; if (a) { a.downed = true; a.emote = null; g.sound.sfx('hurt'); } continue; }
      if (s.rune !== undefined) { ow.runeOn = !!s.rune; continue; }
      // 컷신용 큰 몬스터 (mobs 그림): 등장·이동·공격·퇴장
      if (s.boss) { ow.cutBoss = { kind: s.boss.kind, x: (s.boss.at[0] + 0.5) * TS, y: (s.boss.at[1] + 0.8) * TS, s: s.boss.s || 2, t: 0, atk: 0, dir: 1 }; continue; }
      if (s.bossMove) { const B = ow.cutBoss; if (B) { B.tx = (s.bossMove[0] + 0.5) * TS; B.ty = (s.bossMove[1] + 0.8) * TS; } this.wait = s.t || 0.4; return; }
      if (s.bossAtk) { const B = ow.cutBoss, a = ow.actors[s.bossAtk]; if (B) B.atk = 0.5; if (a) { B && (B.dir = a.x < B.x ? -1 : 1); a.downed = true; a.emote = null; } g.sound.sfx('heavy'); g.view.addShake(10); g.fx && a && g.fx.sfx('imp', a.x, a.y - 50, { s: 1.6, fps: 18 }); continue; }
      if (s.bossGone) { ow.cutBoss = null; continue; }
      if (s.flag) { g.state.flags[s.flag] = true; continue; }
      if (s.objective !== undefined) { g.state.objective = s.objective; continue; }
      if (s.portal !== undefined) { g.portal = s.portal; continue; }
      if (s.mobs) { ow.spawnMobs(s.mobs); continue; }
      if (s.clearMobs) { ow.mobs = []; continue; }
      if (s.fight) {
        const mapId = ow.map.id, p = ow.actors.player, at = [Math.floor(p.x / TS), Math.floor((p.y - 15) / TS)];
        g.eventFight(s.fight, () => { g.enterWorldMode(); ow.load(mapId, at).then(() => this.next()); });
        return;
      }
      if (s.call) { const r = g.cutCall(s.call, s.arg, () => this.next()); if (r === 'async') return; continue; }
      // ---- 분기 (조건 if 가 맞을 때만 이동, 선택지는 flag 로 받아서 분기) ----
      if (s.label) continue;
      if (s.goto) { const k = this.steps.findIndex((x) => x.label === s.goto); if (k >= 0) this.i = k; continue; }
      // ---- 카메라 ----
      if (s.camMove) { ow.camTarget = [(s.camMove[0] + 0.5) * TS, (s.camMove[1] + 0.5) * TS]; if (s.t) { this.wait = s.t; return; } continue; }
      if (s.zoom !== undefined) { g.camZoom = s.zoom; if (s.t) { this.wait = s.t; return; } continue; }
      if (s.camReset) { ow.camTarget = 'player'; g.camZoom = 1; continue; }
      // ---- 진행·보상 ----
      if (s.quest) { if (s.act === 'done') g.quests.complete(s.quest); else g.quests.start(s.quest); continue; }
      if (s.var) { const V = (g.state.vars = g.state.vars || {}); V[s.var] = s.set !== undefined ? s.set : (V[s.var] || 0) + (s.add || 1); continue; }
      if (s.give) { for (const id in s.give) { if (g.gear.isGear(id)) g.gear.give(id); else g.state.inv[id] = (g.state.inv[id] || 0) + s.give[id]; g.onItem(id); } continue; }
      if (s.money) { g.state.money += s.money; continue; }
      if (s.aff) { for (const id in s.aff) g.aff(id, s.aff[id]); continue; }
      if (s.karma) { g.state.karma = (g.state.karma || 0) + s.karma; continue; }
      if (s.sys) { g.sysPopup(s.sys, () => this.next()); return; }
      if (s.event) { g.getJSON(`data/events/${s.event}.json`).then((d) => { this.steps.splice(this.i + 1, 0, ...(d.steps || d)); this.next(); }); return; }
      if (s.end) { this.onEnd(); return; }
    }
  }

  skip() { this.ff = true; if (this.wait > 0) this.wait = 0.0001; if (this.card) this.card.t = this.card.dur; }

  update(dt) {
    if (this.ff) {
      for (const id in this.ow.actors) { const a = this.ow.actors[id]; if (a.path) { a.x = a.path[0]; a.y = a.path[1]; a.path = null; a.route = null; a.moving = false; } }
      this.ow.fade = this.ow.fadeTo;
      if (this.wait > 0) { this.wait = 0; this.next(); return; }
    }
    if (this.card) { this.card.t += dt; if (this.card.t >= this.card.dur) { this.card = null; this.next(); } return; }
    if (this.wait > 0) { this.wait -= dt; if (this.wait <= 0) this.next(); return; }
    if (this.waitFor && this.waitFor()) { this.waitFor = null; this.next(); }
  }
}

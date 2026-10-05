// 탑 층: 미로형 생성. 방 여러 개를 통로로 잇고(갈림길·막다른 길), 경계는 바이옴 벽(나무·바위),
// 높낮이는 절벽 그림과 계단으로 표현. 시작 방에서 가장 먼 방이 보스방, 막다른 방엔 보물 상자.
// World 와 같은 모양(w, h, spawn, solid, moveBody, unstick, randomSpot, drawGround, collectProps)이라 전투 코드는 그대로 쓴다.

function rng(seed) { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177 | 0; return ((h ^ (h >> 16)) >>> 0) / 4294967295; };

export class MazeWorld {
  constructor(A, map, opt = {}) {
    this.A = A; this.m = map; this.maze = true;
    this.TW = map.tile[0]; this.TH = map.tile[1];
    const r = rng(map.seed), SR = opt.slotRows || 3, SC = opt.slotCols || 4, SW = 11, SH = 8;
    this.cols = SC * SW + 2; this.rows = SR * SH + 2;
    this.w = this.cols * this.TW; this.h = this.rows * this.TH;
    const F = (this.F = Array.from({ length: this.rows }, () => new Uint8Array(this.cols)));   // 0 벽, 1 바닥
    this.room = Array.from({ length: this.rows }, () => new Int16Array(this.cols).fill(-1));
    // 방
    this.rooms = [];
    for (let sr = 0; sr < SR; sr++) for (let sc = 0; sc < SC; sc++) {
      const w = 6 + Math.floor(r() * 4), h = 5 + Math.floor(r() * 2);
      const x = 1 + sc * SW + 1 + Math.floor(r() * (SW - w - 1)), y = 1 + sr * SH + 1 + Math.floor(r() * (SH - h - 1));
      this.rooms.push({ i: this.rooms.length, sr, sc, x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2), elev: r() < 0.4 ? 1 : 0, links: [] });
    }
    const at = (sr, sc) => this.rooms[sr * SC + sc];
    // 길: 무작위 깊이 우선으로 모두 잇고, 고리 몇 개 추가
    const start = at(SR - 1, 0); start.elev = 0;
    const seen = new Set([start.i]), stack = [start], edges = [];
    while (stack.length) {
      const c = stack[stack.length - 1];
      const nb = [[0, 1], [1, 0], [0, -1], [-1, 0]].map(([a, b]) => [c.sr + a, c.sc + b]).filter(([a, b]) => a >= 0 && b >= 0 && a < SR && b < SC).map(([a, b]) => at(a, b)).filter((n) => !seen.has(n.i));
      if (!nb.length) { stack.pop(); continue; }
      const n = nb[Math.floor(r() * nb.length)]; seen.add(n.i); edges.push([c, n]); stack.push(n);
    }
    for (let k = 0; k < 2; k++) {
      const a = this.rooms[Math.floor(r() * this.rooms.length)], d = r() < 0.5 ? [0, 1] : [1, 0], b = this.rooms.find((q) => q.sr === a.sr + d[0] && q.sc === a.sc + d[1]);
      if (b && !edges.some(([p, q]) => (p === a && q === b) || (p === b && q === a))) edges.push([a, b]);
    }
    for (const [a, b] of edges) { a.links.push(b); b.links.push(a); }
    // 파기: 방 → 통로(폭 3)
    for (const q of this.rooms) for (let y = q.y; y < q.y + q.h; y++) for (let x = q.x; x < q.x + q.w; x++) { F[y][x] = 1; this.room[y][x] = q.i; }
    this.stairs = [];
    const dig = (x, y) => { for (let o = -1; o <= 1; o++) { if (F[y + o] && y + o > 0 && y + o < this.rows - 1) F[y + o][x] = 1; } };
    const digV = (x, y) => { for (let o = -1; o <= 1; o++) if (x + o > 0 && x + o < this.cols - 1) F[y][x + o] = 1; };
    for (const [a, b] of edges) {
      let x = a.cx, y = a.cy;
      while (x !== b.cx) { dig(x, y); x += Math.sign(b.cx - x); }
      while (y !== b.cy) { digV(x, y); y += Math.sign(b.cy - y); }
      if (a.elev !== b.elev) this.stairs.push([Math.round((a.cx + b.cx) / 2), Math.round((a.cy + b.cy) / 2)]);
    }
    // 보스방: 시작에서 가장 먼 방 / 막다른 방엔 상자
    const dist = new Map([[start.i, 0]]), qu = [start];
    while (qu.length) { const c = qu.shift(); for (const n of c.links) if (!dist.has(n.i)) { dist.set(n.i, dist.get(c.i) + 1); qu.push(n); } }
    this.start = start;
    this.boss = this.rooms.reduce((a, b) => (dist.get(b.i) > dist.get(a.i) ? b : a));
    this.chests = this.rooms.filter((q) => q.links.length === 1 && q !== start && q !== this.boss).map((q) => ({ x: (q.cx + 0.5) * this.TW, y: (q.y + 1.2) * this.TH, chest: true, opened: false, fancy: r() < 0.3 }));
    this.spawn = { x: (start.cx + 0.5) * this.TW, y: (start.cy + 0.5) * this.TH };
    this.seen = Array.from({ length: this.rows }, () => new Uint8Array(this.cols));
    this.locked = false;
    // 바이옴 그림(tower2): 바닥·벽·절벽·계단, 벽 앞 큰 소품, 바닥 작은 소품, 마정석 광맥
    const T2 = A.tower2, ok2 = (k) => T2 && T2[k] && T2[k].w && !T2[k].missing, B = (this.bio = opt.biome || null);
    if (B && ok2(B.wall)) {
      this.art = { floor: B.floor.filter(ok2).map((k) => T2[k]), wall: T2[B.wall], cliff: ok2(B.cliff) ? T2[B.cliff] : null, stairs: ok2(B.stairs) ? T2[B.stairs] : null, sigil: ok2('sigil') ? T2.sigil : null, portal: ok2('portal') ? T2.portal : null };
      this.props = [];
      const big = B.wallProps.filter(ok2).map((k) => T2[k]), small = B.deco.filter(ok2).map((k) => T2[k]);
      for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
        if (F[y][x]) { if (small.length && hash(x * 3, y * 7) < 0.045 && this.room[y][x] >= 0) this.props.push({ kind: 'deco2', f: small[Math.floor(hash(x, y * 5) * small.length)], x: (x + 0.5) * this.TW, y: (y + 0.85) * this.TH }); continue; }
        if (!big.length || !this.edge(x, y) || hash(y, x) > 0.5 || (this.F[y - 1] && this.F[y - 1][x] && this.elevOf(x, y - 1) === 1)) continue;
        this.props.push({ kind: 'wall2', f: big[Math.floor(hash(x * 7, y) * big.length)], x: (x + 0.5) * this.TW, y: (y + 0.98) * this.TH });
      }
      // 마정석 광맥: 일부 방에 하나씩 (채굴하면 조각이 나온다)
      this.ores = [];
      const oreK = ['ore_b', 'ore_b', 'ore_bl', 'ore_r'].filter(ok2);
      for (const q of this.rooms) if (q !== start && q !== this.boss && oreK.length && r() < 0.45) {
        const k = oreK[Math.floor(r() * oreK.length)];
        this.ores.push({ ore: true, k, f: T2[k], x: (q.x + 1 + Math.floor(r() * (q.w - 2)) + 0.5) * this.TW, y: (q.y + 1 + Math.floor(r() * Math.max(1, q.h - 3)) + 0.8) * this.TH });
      }
    } else this.ores = [];
    if (!this.props) this.props = [];
    if (this.art) return;
    // (예전 그림) 벽 소품: 바닥과 맞닿은 벽칸에 바이옴 소품
    const P = A.props, walls = (opt.walls || ['pine', 'tree', 'bush']).map((k) => P[k]).filter((l) => l && l.length);
    const deco = (opt.deco || ['grass', 'rocks', 'shroom']).map((k) => P[k]).filter((l) => l && l.length);
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
      if (F[y][x]) { if (deco.length && hash(x * 3, y * 7) < 0.06) { const l = deco[Math.floor(hash(x, y * 5) * deco.length)]; this.props.push({ kind: 'deco', f: l[Math.floor(hash(y, x) * l.length)], x: (x + 0.5) * this.TW, y: (y + 0.5) * this.TH, col: 0 }); } continue; }
      if (!this.edge(x, y) || !walls.length) continue;
      if (this.below(x, y) && this.elevOf(x, y + 1) === 0 && this.elevOf(x, y - 1) === 1) continue;   // 절벽면은 그림으로
      const l = walls[Math.floor(hash(x, y) * walls.length)];
      this.props.push({ kind: 'wall', f: l[Math.floor(hash(y, x * 3) * l.length)], x: (x + 0.5) * this.TW, y: (y + 0.95) * this.TH, col: 0 });
    }
  }

  edge(x, y) { for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const r = this.F[y + j]; if (r && r[x + i]) return true; } return false; }
  below(x, y) { return this.F[y + 1] && this.F[y + 1][x]; }
  elevOf(x, y) { const i = this.room[y] && this.room[y][x]; return i >= 0 && this.rooms[i] ? this.rooms[i].elev : 0; }
  roomAt(px, py) { const x = Math.floor(px / this.TW), y = Math.floor(py / this.TH); const i = this.room[y] && this.room[y][x]; return i >= 0 ? this.rooms[i] : null; }
  floorAt(x, y) { const c = Math.floor(x / this.TW), r = Math.floor(y / this.TH); return !!(this.F[r] && this.F[r][c]); }

  solid(x, y, r = 20) {
    for (const [dx, dy] of [[-r, -r * 0.5], [r, -r * 0.5], [-r, r * 0.5], [r, r * 0.5]]) if (!this.floorAt(x + dx, y + dy)) return true;
    for (const o of this.ores) if (!o.mined && Math.hypot(o.x - x, (o.y - y) * 1.6) < 34 + r) return true;
    if (this.locked) { const B = this.boss, c = Math.floor(x / this.TW), rr = Math.floor(y / this.TH); if ((c < B.x || c >= B.x + B.w || rr < B.y || rr >= B.y + B.h) && Math.abs(c - B.cx) < B.w && Math.abs(rr - B.cy) < B.h) return true; }
    return false;
  }

  unstick(o, r) {
    if (!this.solid(o.x, o.y, r)) return false;
    for (let d = 12; d < 900; d += 12) for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2, x = o.x + Math.cos(a) * d, y = o.y + Math.sin(a) * d;
      if (!this.solid(x, y, r)) { o.x = x; o.y = y; return true; }
    }
    return false;
  }

  moveBody(o, dx, dy, r) {
    if (this.solid(o.x, o.y, r)) { this.unstick(o, r); return; }
    if (!this.solid(o.x + dx, o.y, r)) o.x += dx;
    if (!this.solid(o.x, o.y + dy, r)) o.y += dy;
  }

  // 몬스터 자리: 시작 방·보스방 밖, 플레이어에게서 멀리
  randomSpot(avoid, minD) {
    const pool = this.rooms.filter((q) => q !== this.start && q !== this.boss);
    for (let i = 0; i < 80; i++) {
      const q = pool[Math.floor(Math.random() * pool.length)];
      const x = (q.x + 0.8 + Math.random() * (q.w - 1.6)) * this.TW, y = (q.y + 0.8 + Math.random() * (q.h - 1.6)) * this.TH;
      if (avoid && Math.hypot(x - avoid.x, y - avoid.y) < Math.max(minD || 0, 700)) continue;
      if (!this.solid(x, y, 30)) return [x, y];
    }
    const q = pool[0]; return [(q.cx + 0.5) * this.TW, (q.cy + 0.5) * this.TH];
  }

  // 가 본 곳 기록 (미니맵 안개)
  reveal(px, py) {
    const c = Math.floor(px / this.TW), r = Math.floor(py / this.TH);
    for (let y = r - 5; y <= r + 5; y++) for (let x = c - 7; x <= c + 7; x++) if (this.seen[y] && x >= 0 && x < this.cols) this.seen[y][x] = 1;
  }

  drawGround(view) {
    const { ctx, cam, W, H, G } = view, T = this.A.tiles, { TW, TH, m } = this;
    ctx.save(); if (m.tint) ctx.filter = m.tint;
    ctx.fillStyle = m.wallColor || '#173018';
    ctx.fillRect(cam.x - W / G, cam.y - H / G, (W / G) * 2, (H / G) * 2);
    const x0 = Math.max(0, Math.floor((cam.x - W / G / 2) / TW) - 1), x1 = Math.min(this.cols - 1, Math.ceil((cam.x + W / G / 2) / TW) + 1);
    const y0 = Math.max(0, Math.floor((cam.y - H / G / 2) / TH) - 1), y1 = Math.min(this.rows - 1, Math.ceil((cam.y + H / G / 2) / TH) + 1);
    if (this.art) {
      const Ar = this.art, fl = Ar.floor;
      for (let r = y0; r <= y1; r++) for (let c = x0; c <= x1; c++) {
        let t;
        if (this.F[r][c]) { const h = hash(c, r); t = fl[h < 0.8 ? 0 : Math.floor(h * 977) % fl.length] || fl[0]; }
        else if (this.F[r - 1] && this.F[r - 1][c] && this.elevOf(c, r - 1) === 1 && Ar.cliff) t = Ar.cliff;
        else t = Ar.wall;
        if (t) ctx.drawImage(t.im, c * TW, r * TH, TW + 0.6, TH + 0.6);
      }
      if (Ar.stairs) for (const [c, r] of this.stairs) if (c >= x0 && c <= x1 && r >= y0 && r <= y1) ctx.drawImage(Ar.stairs.im, c * TW, r * TH, TW + 0.6, TH + 0.6);
      const B = this.boss, bx = (B.cx + 0.5) * TW, by = (B.cy + 0.5) * TH;
      if (Ar.sigil) { ctx.globalAlpha = this.locked ? 0.55 + Math.sin(performance.now() / 200) * 0.2 : 0.25; ctx.drawImage(Ar.sigil.im, bx - TW * 1.6, by - TW * 1.6, TW * 3.2, TW * 3.2); ctx.globalAlpha = 1; }
      if (this.cleared && Ar.portal) ctx.drawImage(Ar.portal.im, bx - TW, by - TW * 0.6, TW * 2, TW * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let r = y0; r <= y1; r++) for (let c = x0; c <= x1; c++) if (this.F[r][c] && this.F[r - 1] && !this.F[r - 1][c]) ctx.fillRect(c * TW, r * TH, TW, 16);
      ctx.restore(); return;
    }
    for (let r = y0; r <= y1; r++) for (let c = x0; c <= x1; c++) {
      if (this.F[r][c]) {
        const h = hash(c, r), t = h < (m.flowerRate || 0.1) ? T.flower[Math.floor(h * 100) % T.flower.length] : T.grass[Math.floor(h * 977) % T.grass.length];
        if (t && t.w) ctx.drawImage(t.im, c * TW, r * TH, TW + 0.6, TH + 0.6);
      } else if (this.F[r - 1] && this.F[r - 1][c] && this.elevOf(c, r - 1) === 1) {
        const t = T.ledge && T.ledge[c % T.ledge.length]; if (t && t.w) ctx.drawImage(t.im, c * TW, r * TH, TW + 0.6, TH + 0.6);   // 높은 방 아래 절벽
      }
    }
    for (const [c, r] of this.stairs) { const t = T.stairs && T.stairs[0]; if (t && t.w && c >= x0 && c <= x1 && r >= y0 && r <= y1) ctx.drawImage(t.im, c * TW, r * TH, TW + 0.6, TH + 0.6); }
    // 벽 가장자리 그림자
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let r = y0; r <= y1; r++) for (let c = x0; c <= x1; c++) if (this.F[r][c] && this.F[r - 1] && !this.F[r - 1][c]) ctx.fillRect(c * TW, r * TH, TW, 14);
    // 보스방 바닥 표시
    const B = this.boss; ctx.strokeStyle = this.locked ? 'rgba(255,60,60,0.6)' : 'rgba(180,60,60,0.25)'; ctx.lineWidth = 6; ctx.strokeRect(B.x * TW + 6, B.y * TH + 6, B.w * TW - 12, B.h * TH - 12);
    ctx.restore();
  }

  collectProps(view, list) {
    const sc = this.TW / 64;
    for (const o of this.ores) if (!o.mined && view.visible(o.x, o.y)) list.push({ y: o.y, d: () => { view.shadow(o.x, o.y - 4, 30); view.ctx.drawImage(o.f.im, o.x - o.f.w * sc / 2, o.y - o.f.h * sc + 6, o.f.w * sc, o.f.h * sc); } });
    if (this.art) {
      for (const p of this.props) {
        if (!view.visible(p.x, p.y)) continue;
        list.push({ y: p.kind === 'deco2' ? p.y - 40 : p.y, d: () => { const w = p.f.w * sc, h = p.f.h * sc; if (p.kind === 'wall2') view.shadow(p.x, p.y - 4, w * 0.3); view.ctx.drawImage(p.f.im, p.x - w / 2, p.y - h, w, h); } });
      }
      const T2 = this.A.tower2;
      for (const c of this.chests) {
        if (!view.visible(c.x, c.y)) continue;
        const f = T2[c.opened ? (c.fancy ? 'chest2_o' : 'chest_o') : (c.fancy ? 'chest2' : 'chest')];
        if (f && f.w) list.push({ y: c.y, d: () => { view.shadow(c.x, c.y - 4, 34); view.ctx.drawImage(f.im, c.x - 48, c.y - 90, 96, 96); } });
      }
      return;
    }
    for (const p of this.props) {
      if (!view.visible(p.x, p.y)) continue;
      list.push({ y: p.y, d: () => {
        if (p.kind === 'wall') view.shadow(p.x, p.y - 4, p.f.w * 0.3);
        if (this.m.tint) { view.ctx.save(); view.ctx.filter = this.m.tint; }
        view.sprite(p.f, p.x, p.y + (p.kind === 'deco' ? p.f.h * 0.5 : 4), 1, false);
        if (this.m.tint) view.ctx.restore();
      } });
    }
    for (const c of this.chests) {
      if (!view.visible(c.x, c.y)) continue;
      list.push({ y: c.y, d: () => {
        const ctx = view.ctx; view.shadow(c.x, c.y, 34);
        ctx.fillStyle = '#1a1420'; ctx.fillRect(c.x - 30, c.y - 46, 60, 46);
        ctx.fillStyle = c.opened ? '#5a4030' : '#9a6a30'; ctx.fillRect(c.x - 27, c.y - 43, 54, 40);
        ctx.fillStyle = c.opened ? '#3a2a20' : '#c9a24a'; ctx.fillRect(c.x - 27, c.y - (c.opened ? 50 : 30), 54, 6); ctx.fillRect(c.x - 4, c.y - 34, 8, 12);
      } });
    }
  }

  // 미니맵: 가 본 곳만
  drawMini(ctx, x, y, w, h, p) {
    const k = Math.min(w / this.cols, h / this.rows), ox = x + (w - this.cols * k) / 2, oy = y + (h - this.rows * k) / 2;
    ctx.fillStyle = 'rgba(6,14,30,0.7)'; ctx.fillRect(x, y, w, h);
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) if (this.F[r][c] && this.seen[r][c]) {
      const B = this.boss, inB = c >= B.x && c < B.x + B.w && r >= B.y && r < B.y + B.h;
      ctx.fillStyle = inB ? '#b85050' : '#8fb4c8'; ctx.fillRect(ox + c * k, oy + r * k, k + 0.3, k + 0.3);
    }
    ctx.fillStyle = '#ffd23f';
    for (const c of this.chests) if (!c.opened && this.seen[Math.floor(c.y / this.TH)][Math.floor(c.x / this.TW)]) ctx.fillRect(ox + c.x / this.TW * k - 2, oy + c.y / this.TH * k - 2, 4, 4);
    ctx.fillStyle = '#ff4a4a'; ctx.fillRect(ox + p.x / this.TW * k - 2.5, oy + p.y / this.TH * k - 2.5, 5, 5);
  }
}

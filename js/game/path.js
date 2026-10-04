// 길 찾기 (A*, 8방향, 대각선은 양옆이 막혀 있으면 금지). blocked(c, r) 로 막힌 칸을 알려준다.
export function findPath(cols, rows, blocked, sc, sr, gc, gr, maxNodes = 4000) {
  if (gc < 0 || gr < 0 || gc >= cols || gr >= rows) return null;
  if (blocked(gc, gr)) {
    let best = null, bd = 1e9;
    for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) {
      const c = gc + dc, r = gr + dr;
      if (c < 0 || r < 0 || c >= cols || r >= rows || blocked(c, r)) continue;
      const d = dc * dc + dr * dr; if (d < bd) { bd = d; best = [c, r]; }
    }
    if (!best) return null; [gc, gr] = best;
  }
  const key = (c, r) => r * cols + c, H = (c, r) => Math.hypot(c - gc, r - gr);
  const open = [[H(sc, sr), 0, sc, sr]], from = new Map(), gs = new Map([[key(sc, sr), 0]]);
  let n = 0;
  while (open.length && n++ < maxNodes) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [, g, c, r] = open.splice(bi, 1)[0];
    if (c === gc && r === gr) {
      const out = [[c, r]]; let k = key(c, r);
      while (from.has(k)) { const p = from.get(k); out.unshift(p); k = key(p[0], p[1]); }
      return out;
    }
    for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
      if (!dc && !dr) continue;
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows || blocked(nc, nr)) continue;
      if (dc && dr && (blocked(c + dc, r) || blocked(c, r + dr))) continue;
      const ng = g + (dc && dr ? 1.414 : 1), k = key(nc, nr);
      if (ng < (gs.get(k) ?? 1e9)) { gs.set(k, ng); from.set(k, [c, r]); open.push([ng + H(nc, nr), ng, nc, nr]); }
    }
  }
  return null;
}

// 탑 층 지도용 이동 격자 (44px 칸)
export class NavGrid {
  constructor(world, cell = 44) {
    this.w = world; this.cell = cell;
    this.cols = Math.ceil(world.w / cell); this.rows = Math.ceil(world.h / cell);
    this.block = new Uint8Array(this.cols * this.rows);
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) this.block[r * this.cols + c] = world.solid((c + 0.5) * cell, (r + 0.5) * cell, 16) ? 1 : 0;
  }
  blocked(c, r) { return this.block[r * this.cols + c] === 1; }
  clear(x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 22);
    for (let i = 1; i < n; i++) { const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n; if (this.blocked(Math.floor(x / this.cell), Math.floor(y / this.cell))) return false; }
    return true;
  }
  route(x0, y0, x1, y1) {
    const C = this.cell, p = findPath(this.cols, this.rows, (c, r) => this.blocked(c, r), Math.floor(x0 / C), Math.floor(y0 / C), Math.floor(x1 / C), Math.floor(y1 / C), 2500);
    return p ? p.slice(1).map(([c, r]) => [(c + 0.5) * C, (r + 0.5) * C]) : null;
  }
}

// 막히면 길을 찾아 돌아가는 이동: o.route 를 쓰고, 0.5초마다 다시 계산
export function steer(nav, o, gx, gy, sp, dt, w, rad) {
  if (nav.clear(o.x, o.y, gx, gy)) { o.route = null; }
  else if (!o.route || (o.routeT = (o.routeT || 0) - dt) <= 0) { o.route = nav.route(o.x, o.y, gx, gy); o.routeT = 0.5; }
  let tx = gx, ty = gy;
  if (o.route && o.route.length) { [tx, ty] = o.route[0]; if (Math.hypot(tx - o.x, ty - o.y) < 18) { o.route.shift(); if (o.route.length) [tx, ty] = o.route[0]; else [tx, ty] = [gx, gy]; } }
  const dx = tx - o.x, dy = ty - o.y, d = Math.hypot(dx, dy) || 1;
  const ox = o.x, oy = o.y;
  w.moveBody(o, dx / d * sp * dt, dy / d * sp * dt, rad);
  if (Math.hypot(o.x - ox, o.y - oy) < sp * dt * 0.2) o.routeT = 0;
  return [dx / d, dy / d];
}

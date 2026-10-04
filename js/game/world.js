// 층 지도: data/maps/*.json 의 설정으로 타일, 흙길, 나무와 장식, 충돌을 만든다.

function rng(seed) { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177 | 0; return ((h ^ (h >> 16)) >>> 0) / 4294967295; };

export class World {
  constructor(A, map) {
    this.A = A; this.m = map;
    this.TW = map.tile[0]; this.TH = map.tile[1];
    this.w = map.cols * this.TW; this.h = map.rows * this.TH;
    this.props = [];
    this.spawn = { x: map.spawn[0] * this.TW, y: map.spawn[1] * this.TH };
    const r = rng(map.seed);
    const place = (kind, list, n, col, minD) => {
      let tries = 0;
      while (n > 0 && tries < 4000) {
        tries++;
        const x = this.TW + r() * this.TW * (map.cols - 2);
        const y = this.TH * (map.ledgeRow + 1.3) + r() * this.TH * (map.rows - map.ledgeRow - 2);
        if (Math.hypot(x - this.spawn.x, y - this.spawn.y) < 380) continue;
        if (Math.abs(x - (map.stairCol + 0.5) * this.TW) < 140 && y < this.TH * (map.ledgeRow + 4)) continue;
        if (this.props.some((p) => Math.hypot(p.x - x, p.y - y) < (minD || 70))) continue;
        this.props.push({ kind, f: list[Math.floor(r() * list.length)], x, y, col });
        n--;
      }
    };
    const P = A.props;
    for (const p of map.props) place(p.kind, P[p.set], p.count, p.col, p.minDist);
    for (let i = 0; i < map.ledgeTrees; i++) {
      const x = this.TW + r() * this.TW * (map.cols - 2);
      this.props.push({ kind: 'tree', f: P.pine[Math.floor(r() * P.pine.length)], x, y: this.TH * (map.ledgeRow - 1.1) + r() * this.TH * 0.8, col: 0 });
    }
  }

  solid(x, y, r) {
    const { TW, TH, m } = this;
    if (x < TW * 0.6 || x > this.w - TW * 0.6 || y > this.h - TH * 0.4 || y < TH * 0.8) return true;
    if (y > TH * m.ledgeRow - 10 && y < TH * (m.ledgeRow + 1) + 6 && Math.abs(x - (m.stairCol + 0.5) * TW) > 40) return true;
    for (const p of this.props) {
      if (!p.col) continue;
      if (Math.hypot(p.x - x, (p.y - y) * 1.6) < p.col + r) return true;
    }
    return false;
  }

  // 구조물 안에 끼었으면 가장 가까운 빈자리로 빼낸다
  unstick(o, r) {
    if (!this.solid(o.x, o.y, r)) return false;
    for (let d = 12; d < 600; d += 12) {
      for (let k = 0; k < 16; k++) {
        const a = k / 16 * Math.PI * 2, x = o.x + Math.cos(a) * d, y = o.y + Math.sin(a) * d;
        if (!this.solid(x, y, r)) { o.x = x; o.y = y; return true; }
      }
    }
    return false;
  }

  moveBody(o, dx, dy, r) {
    if (this.solid(o.x, o.y, r)) { this.unstick(o, r); return; }
    if (!this.solid(o.x + dx, o.y, r)) o.x += dx;
    if (!this.solid(o.x, o.y + dy, r)) o.y += dy;
  }

  randomSpot(avoid, minD) {
    for (let i = 0; i < 60; i++) {
      const x = this.TW * 2 + Math.random() * (this.w - this.TW * 4);
      const y = this.TH * (this.m.ledgeRow + 2) + Math.random() * (this.h - this.TH * (this.m.ledgeRow + 4));
      if (avoid && Math.hypot(x - avoid.x, y - avoid.y) < minD) continue;
      if (!this.solid(x, y, 30)) return [x, y];
    }
    return [this.TW * 3, this.h - this.TH * 3];
  }

  drawGround(view) {
    const { ctx, cam, W, H, G } = view;
    const T = this.A.tiles, { TW, TH, m } = this;
    ctx.fillStyle = m.bg || '#4cb82c';
    ctx.fillRect(cam.x - W / G, cam.y - H / G, (W / G) * 2, (H / G) * 2);
    const x0 = Math.floor((cam.x - W / G / 2) / TW) - 1, x1 = Math.ceil((cam.x + W / G / 2) / TW) + 1;
    const y0 = Math.floor((cam.y - H / G / 2) / TH) - 1, y1 = Math.ceil((cam.y + H / G / 2) / TH) + 1;
    for (let r = Math.max(0, y0); r <= Math.min(m.rows - 1, y1); r++) {
      for (let c = Math.max(0, x0); c <= Math.min(m.cols - 1, x1); c++) {
        let t;
        if (r === m.ledgeRow) t = c === m.stairCol ? T.stairs[0] : T.ledge[c % T.ledge.length];
        else {
          const h = hash(c, r);
          t = h < m.flowerRate ? T.flower[Math.floor(h * 100) % T.flower.length] : T.grass[Math.floor(h * 977) % T.grass.length];
        }
        if (t && t.w) ctx.drawImage(t.im, c * TW, r * TH, TW + 0.6, TH + 0.6);
      }
    }
    const path = T.path && T.path[0];
    if (path && path.w) for (const p of m.paths) ctx.drawImage(path.im, p[0] * TW, p[1] * TH, path.w, path.h);
  }

  collectProps(view, list) {
    for (const p of this.props) {
      if (!view.visible(p.x, p.y)) continue;
      list.push({ y: p.y, d: () => {
        if (p.kind !== 'deco') view.shadow(p.x, p.y - 2, p.f.w * 0.32);
        view.sprite(p.f, p.x, p.y + (p.kind === 'deco' ? p.f.h * 0.5 : 6), 1, false);
      } });
    }
  }
}

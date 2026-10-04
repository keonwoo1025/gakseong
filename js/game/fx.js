// 이펙트와 데미지 숫자.

export class FX {
  constructor(A, view) { this.A = A; this.v = view; this.list = []; this.nums = []; }

  frames(set) { const n = this.A.fx2 && this.A.fx2[set]; return n && n.length && !n[0].missing ? n : this.A.fx[set]; }

  sfx(set, x, y, o = {}) {
    const frames = this.frames(set);
    const base = set.replace(/^cm_/, '');
    if (frames === (this.A.fx2 && this.A.fx2[set]) && this.A.fx[base] && this.A.fx[base][0]) {
      // 새 이펙트 그림은 크기가 달라서 기존 배율에 맞춘다
      const old = this.A.fx[base][0], nw = frames[0];
      if (old.w && nw.w) o = Object.assign({}, o, { s: (o.s || 1) * Math.max(old.w, old.h) / Math.max(nw.w, nw.h) });
    }
    if (!frames || !frames.length) return;
    this.list.push(Object.assign({ set, x, y, t: 0, fps: 16, s: 1, rot: 0, flip: false, ground: false, a: 1 }, o, { n: frames.length }));
  }

  beam(x, y, ang, len, w, col) { this.beams = this.beams || []; this.beams.push({ x, y, ang, len, w, col, t: 0 }); }

  num(x, y, v, kind = 'normal') { this.nums.push({ x: x + (Math.random() - 0.5) * 24, y, v, t: 0, kind, vx: (Math.random() - 0.5) * 40 }); }

  update(dt) {
    if (this.beams) { for (const b of this.beams) b.t += dt; this.beams = this.beams.filter((b) => b.t < 0.38); }
    for (const f of this.list) f.t += dt;
    this.list = this.list.filter((f) => f.t < f.n / f.fps);
    for (const n of this.nums) n.t += dt;
    this.nums = this.nums.filter((n) => n.t < 0.95);
  }

  draw(ground) {
    const ctx = this.v.ctx;
    if (!ground && this.beams) for (const b of this.beams) {
      const k = b.t / 0.38, grow = Math.min(1, b.t / 0.06);
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.ang);
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = b.col; ctx.fillRect(0, -b.w / 2 * (1 - k * 0.5), b.len * grow, b.w * (1 - k * 0.5));
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, -b.w / 8, b.len * grow, b.w / 4);
      ctx.fillStyle = '#1a0f08'; ctx.fillRect(0, -b.w / 2 * (1 - k * 0.5) - 3, b.len * grow, 3); ctx.fillRect(0, b.w / 2 * (1 - k * 0.5), b.len * grow, 3);
      ctx.restore();
    }
    for (const f of this.list) {
      if (f.ghost || !!f.ground !== ground) continue;
      const arr = this.frames(f.set); if (!arr) continue;
      const fr = arr[Math.min(arr.length - 1, Math.floor(f.t * f.fps))];
      if (!fr || !fr.w) continue;
      ctx.save();
      ctx.globalAlpha = f.a;
      ctx.translate(Math.round(f.x), Math.round(f.y));
      ctx.rotate(f.rot);
      if (f.flip) ctx.scale(-1, 1);
      ctx.drawImage(fr.im, -fr.w * f.s / 2, -fr.h * f.s / 2, fr.w * f.s, fr.h * f.s);
      ctx.restore();
    }
  }

  drawNums() {
    const ctx = this.v.ctx;
    const style = {
      normal: [800, 34, '#ffffff'], big: [900, 42, '#ffd23f'], huge: [900, 56, '#ff9a2e'], hurt: [800, 34, '#ff5a5a'], exp: [700, 26, '#9fe07a'],
      miss: [800, 28, '#b8c4d0'], parry: [900, 60, '#7fe8ff'], dodge: [700, 22, '#e8f4ff'], skill: [900, 30, '#ffe9a8'],
    };
    for (const n of this.nums) {
      const [w, size, col] = style[n.kind] || style.normal;
      const pop = n.t < 0.1 ? 1.5 - n.t * 5 : 1;
      ctx.save();
      ctx.globalAlpha = n.t > 0.6 ? Math.max(0, 1 - (n.t - 0.6) / 0.35) : 1;
      ctx.translate(n.x + n.vx * n.t, n.y - Math.min(n.t, 0.5) * 70);
      ctx.scale(pop, pop);
      ctx.font = `${w} ${size}px system-ui,sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 7; ctx.strokeStyle = '#1a0f08'; ctx.fillStyle = col;
      ctx.strokeText(n.v, 0, 0); ctx.fillText(n.v, 0, 0);
      ctx.restore();
    }
  }
}

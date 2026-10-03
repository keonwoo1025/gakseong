// 이펙트와 데미지 숫자.

export class FX {
  constructor(A, view) { this.A = A; this.v = view; this.list = []; this.nums = []; }

  sfx(set, x, y, o = {}) {
    const frames = this.A.fx[set];
    if (!frames || !frames.length) return;
    this.list.push(Object.assign({ set, x, y, t: 0, fps: 16, s: 1, rot: 0, flip: false, ground: false, a: 1 }, o, { n: frames.length }));
  }

  num(x, y, v, kind = 'normal') { this.nums.push({ x: x + (Math.random() - 0.5) * 20, y, v, t: 0, kind }); }

  update(dt) {
    for (const f of this.list) f.t += dt;
    this.list = this.list.filter((f) => f.t < f.n / f.fps);
    for (const n of this.nums) n.t += dt;
    this.nums = this.nums.filter((n) => n.t < 0.8);
  }

  draw(ground) {
    const ctx = this.v.ctx;
    for (const f of this.list) {
      if (f.ghost || !!f.ground !== ground) continue;
      const arr = this.A.fx[f.set];
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
      normal: ['800 26px', '#ffffff'], big: ['900 34px', '#ffd23f'], huge: ['900 46px', '#ff9a2e'], hurt: ['800 26px', '#ff5a5a'], exp: ['700 22px', '#9fe07a'],
    };
    for (const n of this.nums) {
      const [font, col] = style[n.kind] || style.normal;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - n.t / 0.8);
      ctx.font = font + ' system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 6; ctx.strokeStyle = '#2a1a10'; ctx.fillStyle = col;
      const y = n.y - n.t * 50;
      ctx.strokeText(n.v, n.x, y); ctx.fillText(n.v, n.x, y);
      ctx.restore();
    }
  }
}

// 화면: 캔버스 크기, 확대 비율, 카메라, 그리기 도우미.

export class View {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = 0; this.H = 0; this.DPR = 1; this.G = 1;
    this.cam = { x: 0, y: 0 };
    this.shake = { t: 0, a: 0 };
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.DPR = Math.min(window.devicePixelRatio || 1, 2);
    this.W = this.c.clientWidth || window.innerWidth;
    this.H = this.c.clientHeight || window.innerHeight;
    this.c.width = Math.round(this.W * this.DPR);
    this.c.height = Math.round(this.H * this.DPR);
    // 화면 높이에 타일 약 6.2줄이 보이도록
    this.G = Math.max(0.42, Math.min(1.25, this.H / (96 * 6.2)));
  }

  screen() {
    const { ctx, DPR } = this;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
  }

  world() {
    const { ctx, DPR, G, W, H, cam, shake } = this;
    let sx = 0, sy = 0;
    if (shake.t > 0) { const k = shake.t / 0.25; sx = (Math.random() - 0.5) * shake.a * 2 * k; sy = (Math.random() - 0.5) * shake.a * 2 * k; }
    ctx.setTransform(DPR * G, 0, 0, DPR * G, Math.round(DPR * (W / 2 - cam.x * G + sx)), Math.round(DPR * (H / 2 - cam.y * G + sy)));
    ctx.imageSmoothingEnabled = false;
  }

  addShake(a) { this.shake.t = 0.25; this.shake.a = a; }
  update(dt) { this.shake.t = Math.max(0, this.shake.t - dt); }

  follow(x, y, dt, bounds) {
    const c = this.cam;
    c.x += (x - c.x) * Math.min(1, dt * 7);
    c.y += (y - c.y) * Math.min(1, dt * 7);
    if (bounds) {
      const hw = this.W / this.G / 2, hh = this.H / this.G / 2;
      c.x = Math.max(hw, Math.min(bounds.w - hw, c.x));
      c.y = Math.max(hh, Math.min(bounds.h - hh, c.y));
    }
  }

  visible(x, y, pad = 200) {
    const hw = this.W / this.G / 2, hh = this.H / this.G / 2;
    return x > this.cam.x - hw - pad && x < this.cam.x + hw + pad && y > this.cam.y - hh - 60 && y < this.cam.y + hh + 300;
  }

  sprite(f, x, y, s = 1, flip = false, alpha = 1) {
    if (!f || !f.w) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(Math.round(x), Math.round(y));
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(f.im, -f.ax * s, -f.ay * s, f.w * s, f.h * s);
    ctx.restore();
  }

  shadow(x, y, rx) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(20,40,10,0.32)';
    ctx.beginPath(); ctx.ellipse(x, y, rx, rx * 0.36, 0, 0, Math.PI * 2); ctx.fill();
  }
}

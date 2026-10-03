// 입력: 왼쪽 절반은 보이지 않는 조이스틱, 오른쪽은 탭(공격)과 밀기(회피).
// 대화나 메뉴 중에는 모든 터치를 tap 이벤트로 넘긴다.

export class Input {
  constructor(canvas) {
    this.c = canvas;
    this.mode = 'field';
    this.joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.rg = { id: null, sx: 0, sy: 0, t: 0 };
    this.keys = {};
    this.h = {};
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
  }

  on(name, fn) { this.h[name] = fn; }
  emit(name, ...a) { this.h[name] && this.h[name](...a); }

  reset() { this.joy.id = null; this.rg.id = null; }

  down(e) {
    try { this.c.setPointerCapture(e.pointerId); } catch (_) {}
    if (this.mode !== 'field') { this.emit('tap', e.clientX, e.clientY); return; }
    const W = this.c.clientWidth;
    if (e.clientX < W * 0.45 && this.joy.id === null) {
      this.joy.id = e.pointerId;
      this.joy.ox = this.joy.x = e.clientX;
      this.joy.oy = this.joy.y = e.clientY;
    } else if (this.rg.id === null) {
      this.rg.id = e.pointerId;
      this.rg.sx = e.clientX; this.rg.sy = e.clientY; this.rg.t = performance.now();
    }
  }

  move(e) {
    if (e.pointerId === this.joy.id) { this.joy.x = e.clientX; this.joy.y = e.clientY; }
  }

  up(e) {
    if (e.pointerId === this.joy.id) { this.joy.id = null; return; }
    if (e.pointerId === this.rg.id) {
      const dx = e.clientX - this.rg.sx, dy = e.clientY - this.rg.sy;
      const d = Math.hypot(dx, dy), dt = performance.now() - this.rg.t;
      if (d > 40 && dt < 450) this.emit('dodge', dx, dy);
      else if (d < 25) this.emit('attack');
      this.rg.id = null;
    }
  }

  key(e, isDown) {
    const k = e.key.toLowerCase();
    this.keys[k] = isDown;
    if (!isDown) return;
    if (this.mode !== 'field') {
      if (k === ' ' || k === 'enter' || k === 'j') this.emit('tap', -1, -1);
      return;
    }
    if (k === 'j' || k === 'z') this.emit('attack');
    if (k === 'k' || k === 'x' || k === ' ') { const v = this.vec(); this.emit('dodge', v[0], v[1]); }
  }

  vec() {
    let x = 0, y = 0;
    if (this.joy.id !== null) {
      x = (this.joy.x - this.joy.ox) / 55; y = (this.joy.y - this.joy.oy) / 55;
    } else {
      const k = this.keys;
      if (k.a || k.arrowleft) x -= 1; if (k.d || k.arrowright) x += 1;
      if (k.w || k.arrowup) y -= 1; if (k.s || k.arrowdown) y += 1;
    }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return [x, y];
  }

  running() { return !!this.keys.shift; }
}

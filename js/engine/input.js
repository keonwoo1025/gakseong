// 입력: 조이스틱(고정/자유)과 화면 버튼(공격, 회피, 스킬, 물약), 키보드.
// 손가락이 조이스틱 밖이나 화면 밖으로 나가도 방향은 유지되고, 손을 떼야 멈춘다.
import { Settings } from './settings.js';

export class Input {
  constructor(canvas) {
    this.c = canvas;
    this.mode = 'field';
    this.joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.swipe = { id: null, sx: 0, sy: 0, t: 0 };
    this.keys = {};
    this.h = {};
    this.buttons = [];        // 게임이 매 프레임 채움: {id, x, y, r}
    this.pressed = {};        // 버튼 눌림 표시
    this.btnTouch = {};
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => this.reset());
  }

  on(name, fn) { this.h[name] = fn; }
  emit(name, ...a) { this.h[name] && this.h[name](...a); }
  reset() { this.joy.id = null; this.swipe.id = null; this.pressed = {}; this.btnTouch = {}; }

  joyBase() {
    const W = this.c.clientWidth, H = this.c.clientHeight, r = Settings.joyRadius();
    const x = Settings.v.lefty ? W - r - 34 : r + 34;
    return { x, y: H - r - 28, r };
  }

  down(e) {
    try { this.c.setPointerCapture(e.pointerId); } catch (_) {}
    const x = e.clientX, y = e.clientY;
    for (const b of this.buttons) {
      if (b.always && Math.hypot(x - b.x, y - b.y) < b.r * 1.2) { this.pressed[b.id] = 0.15; this.btnTouch[e.pointerId] = b.id; this.emit('button', b.id); return; }
    }
    if (this.mode !== 'field') { this.emit('tap', x, y); return; }
    for (const b of this.buttons) {
      if (b.locked) continue;
      if (Math.hypot(x - b.x, y - b.y) < b.r * 1.15) { this.pressed[b.id] = 0.15; this.btnTouch[e.pointerId] = b.id; this.emit('button', b.id); return; }
    }
    const W = this.c.clientWidth, lefty = Settings.v.lefty;
    const onJoySide = lefty ? x > W * 0.55 : x < W * 0.45;
    if (onJoySide && this.joy.id === null) {
      const base = this.joyBase();
      this.joy.id = e.pointerId;
      if (Settings.v.joyMode === 'fixed') { this.joy.ox = base.x; this.joy.oy = base.y; }
      else { this.joy.ox = x; this.joy.oy = y; }
      this.joy.x = x; this.joy.y = y;
      return;
    }
    if (this.swipe.id === null) { this.swipe.id = e.pointerId; this.swipe.sx = x; this.swipe.sy = y; this.swipe.t = performance.now(); }
  }

  move(e) {
    if (e.pointerId === this.joy.id) { this.joy.x = e.clientX; this.joy.y = e.clientY; }
  }

  up(e) {
    if (e.pointerId === this.joy.id) { this.joy.id = null; return; }
    if (this.btnTouch[e.pointerId]) { delete this.btnTouch[e.pointerId]; return; }
    if (e.pointerId === this.swipe.id) {
      const dx = e.clientX - this.swipe.sx, dy = e.clientY - this.swipe.sy;
      if (Settings.v.swipeDodge && Math.hypot(dx, dy) > 45 && performance.now() - this.swipe.t < 450) this.emit('dodge', dx, dy);
      this.swipe.id = null;
    }
  }

  key(e, isDown) {
    const k = e.key.toLowerCase();
    this.keys[k] = isDown;
    if (!isDown) return;
    if (this.mode !== 'field') { if (k === ' ' || k === 'enter' || k === 'j') this.emit('tap', -1, -1); return; }
    if (k === 'j' || k === 'z' || k === 'enter') this.emit('button', 'act');
    if (k === 'k' || k === 'x' || k === ' ') this.emit('button', 'dodge');
    if (k === 'l') this.emit('button', 'skill1');
    if (k === 'h') this.emit('button', 'potion');
    if (k === 'm' || k === 'escape') this.emit('button', 'menu');
  }

  // 방향과 세기 (0~1). 조이스틱 반지름의 일정 비율에서 최대가 된다.
  vec() {
    let x = 0, y = 0;
    if (this.joy.id !== null) {
      const R = Settings.joyRadius() * Settings.sensK();
      x = (this.joy.x - this.joy.ox) / R; y = (this.joy.y - this.joy.oy) / R;
      const l = Math.hypot(x, y);
      if (l < 0.12) return [0, 0];
    } else {
      const k = this.keys;
      if (k.a || k.arrowleft) x -= 1; if (k.d || k.arrowright) x += 1;
      if (k.w || k.arrowup) y -= 1; if (k.s || k.arrowdown) y += 1;
      if (k.shift && (x || y)) { const l = Math.hypot(x, y); return [x / l, y / l]; }
      if (x || y) { const l = Math.hypot(x, y); return [x / l * 0.8, y / l * 0.8]; }
    }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return [x, y];
  }

  running() { const v = this.vec(); return Math.hypot(v[0], v[1]) >= Settings.runK() || !!this.keys.shift; }

  update(dt) { for (const k in this.pressed) { this.pressed[k] -= dt; if (this.pressed[k] <= 0) delete this.pressed[k]; } }
}

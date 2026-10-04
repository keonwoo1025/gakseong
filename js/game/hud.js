// 화면 정보와 조작 버튼, 대화창. 각성 전에는 평범한 화면, 각성 후에는 시스템창 색감.
import { Settings } from '../engine/settings.js';

const PLAIN = { sys: false, bg: 'rgba(26,26,32,0.86)', line: 'rgba(255,255,255,0.18)', accent: '#e9a85a', text: '#f2f2f4', dim: '#a9a9b2', act: 'rgba(233,168,90,0.85)', glow: null };
const SYS = { sys: true, bg: 'rgba(6,14,30,0.86)', line: '#5cc8ff', accent: '#7fd8ff', text: '#eaf6ff', dim: '#8fb4cc', act: 'rgba(40,110,170,0.85)', glow: 'rgba(92,200,255,0.8)' };

// UI 껍데기: data/manifest.json 의 ui 묶음에 같은 이름의 그림이 있으면 그 그림을 쓰고, 없으면 코드로 그린다.
let SKIN = () => null;
export function setSkin(fn) { SKIN = fn; }
const skin = (n) => { const o = SKIN(n); return o && o.im && !o.missing ? o : null; };
// 테마별 아이콘: 시스템창에서는 _sys 버전을 먼저 찾는다
const icon = (n, T) => (T.sys && skin(n + '_sys')) || skin(n);

// 9칸 분할: 모서리는 그대로, 변과 가운데는 늘려서 어떤 크기의 창에도 맞춘다
function nine(ctx, o, x, y, w, h, b = 12) {
  const im = o.im, W = o.w, H = o.h, d = Math.min(b, w / 2, h / 2);
  const sx = [0, b, W - b, W], sy = [0, b, H - b, H], dx = [x, x + d, x + w - d, x + w], dy = [y, y + d, y + h - d, y + h];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const sw = sx[i + 1] - sx[i], sh = sy[j + 1] - sy[j], dw = dx[i + 1] - dx[i], dh = dy[j + 1] - dy[j];
    if (sw > 0 && sh > 0 && dw > 0 && dh > 0) ctx.drawImage(im, sx[i], sy[j], sw, sh, dx[i], dy[j], dw, dh);
  }
}

function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

export function frame(ctx, x, y, w, h, T, kind = 'panel') {
  const sk = skin(kind + (T.sys ? '_sys' : '')) || (kind !== 'panel' && skin('panel' + (T.sys ? '_sys' : '')));
  if (sk) { nine(ctx, sk, x, y, w, h, kind === 'dialog' ? 18 : 14); return; }
  if (T.sys) {
    ctx.fillStyle = T.bg; ctx.fillRect(x, y, w, h);
    ctx.save(); ctx.shadowColor = T.glow; ctx.shadowBlur = 8; ctx.strokeStyle = T.line; ctx.lineWidth = 1.2; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); ctx.restore();
    ctx.strokeStyle = '#bfeaff'; ctx.lineWidth = 2;
    const c = Math.min(10, w / 4, h / 4);
    ctx.beginPath(); ctx.moveTo(x - 1, y + c); ctx.lineTo(x - 1, y - 1); ctx.lineTo(x + c, y - 1);
    ctx.moveTo(x + w + 1, y + h - c); ctx.lineTo(x + w + 1, y + h + 1); ctx.lineTo(x + w - c, y + h + 1); ctx.stroke();
  } else {
    ctx.fillStyle = T.bg; rr(ctx, x, y, w, h, Math.min(12, h / 2)); ctx.fill();
    ctx.strokeStyle = T.line; ctx.lineWidth = 1; ctx.stroke();
  }
}

function wrap(ctx, text, maxW) {
  const out = []; let line = '';
  for (const ch of text) {
    if (ch === '\n') { out.push(line); line = ''; continue; }
    if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; } else line += ch;
  }
  if (line) out.push(line);
  return out;
}

function outlined(ctx, text, x, y) { ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.strokeText(text, x, y); ctx.fillText(text, x, y); }
const F = (w, s) => `${w} ${s}px system-ui,"Apple SD Gothic Neo","Noto Sans KR",sans-serif`;

export class HUD {
  constructor(g) { this.g = g; this.hintT = 0; this.toast = null; }
  T() { return this.g.state && this.g.awakened() ? SYS : PLAIN; }
  say(text, t = 2.4) { this.toast = { text, t }; }
  update(dt) { this.hintT = Math.max(0, this.hintT - dt); if (this.toast) { this.toast.t -= dt; if (this.toast.t <= 0) this.toast = null; } }

  // ---------- 공통 조각 ----------
  topInfo(text) {
    const ctx = this.g.view.ctx, T = this.T();
    ctx.font = F(600, 11); ctx.textAlign = 'left'; ctx.fillStyle = T.text;
    outlined(ctx, text, 12, 62);
  }

  objective() {
    const g = this.g, s = g.state, v = g.view, ctx = v.ctx, T = this.T();
    if (!s || !s.objective) return;
    ctx.font = F(700, 12);
    const txt = '▶ ' + s.objective;
    const maxW = Math.min(420, v.W - 330);
    const lines = wrap(ctx, txt, maxW).slice(0, 2);
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20, h = lines.length * 16 + 10;
    const x = v.W / 2 - w / 2, y = 10;
    frame(ctx, x, y, w, h, T);
    ctx.fillStyle = T.sys ? '#bfeaff' : '#ffe2b8'; ctx.textAlign = 'center';
    lines.forEach((l, i) => ctx.fillText(l, v.W / 2, y + 18 + i * 16));
    ctx.textAlign = 'left';
  }

  bars(mode) {
    const g = this.g, s = g.state, v = g.view, ctx = v.ctx, T = this.T();
    const w = Math.max(170, Math.min(340, v.W - 440)), x = v.W / 2 - w / 2, y = v.H - 34;
    frame(ctx, x - 8, y - 8, w + 16, 34, T);
    const hpK = Math.max(0, Math.min(1, s.hp / g.maxHp()));
    const awake = g.awakened();
    const lvW = 46;
    ctx.fillStyle = T.accent; ctx.font = F(800, 12); ctx.textAlign = 'left';
    ctx.fillText(awake ? 'LV.' + String(s.lv).padStart(2, '0') : '비각성', x, y + 12);
    const bx = x + lvW, bw = w - lvW;
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(bx, y + 1, bw, 7); ctx.fillRect(bx, y + 11, bw, 5);
    const bsk = skin('bar' + (T.sys ? '_sys' : ''));
    ctx.fillStyle = '#e8433f'; ctx.fillRect(bx, y + 1, bw * hpK, 7);
    if (bsk) nine(ctx, bsk, bx - 3, y - 2, bw + 6, 13, 8);
    if (awake) {
      ctx.fillStyle = '#4aa3ff'; ctx.fillRect(bx, y + 11, bw * Math.min(1, (s.mp || 0) / g.maxMp()), 5);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x, y + 20, w, 3);
      ctx.fillStyle = '#9fe07a'; ctx.fillRect(x, y + 20, w * Math.min(1, s.exp / g.expNeed()), 3);
    } else {
      ctx.fillStyle = T.dim; ctx.font = F(600, 9); ctx.fillText(Math.round(s.hp) + ' / ' + g.maxHp(), bx, y + 18);
    }
  }

  drawToast() {
    const v = this.g.view, ctx = v.ctx, T = this.T();
    if (!this.toast) return;
    ctx.globalAlpha = Math.min(1, this.toast.t * 2);
    const text = T.sys ? '[알림] ' + this.toast.text : this.toast.text;
    ctx.font = F(700, 13);
    const w = ctx.measureText(text).width + 28, x = v.W / 2 - w / 2, y = v.H * 0.2;
    frame(ctx, x, y, w, 28, T);
    ctx.fillStyle = T.sys ? '#bfeaff' : '#ffe2b8'; ctx.textAlign = 'center'; ctx.fillText(text, v.W / 2, y + 19);
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
  }

  // ---------- 모드별 ----------
  // 대상 체력·아픈 표정·콤보 (탑·마을 공통)
  combatBits(B) {
    const g = this.g, v = g.view, ctx = v.ctx, T = this.T(), W = v.W;
    const tg = g.target;
    if (tg && tg.e.alive && tg.t > 0 && tg.e !== B) {
      const w = 200, x = W / 2 - w / 2, y = 56;
      frame(ctx, x, y, w, 24, T);
      ctx.font = F(700, 11); ctx.fillStyle = T.text; ctx.textAlign = 'left';
      ctx.fillText(tg.e.d.name || '', x + 8, y + 15);
      ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(x + 92, y + 9, w - 100, 6);
      ctx.fillStyle = '#e8433f'; ctx.fillRect(x + 92, y + 9, (w - 100) * Math.max(0, tg.e.hp / tg.e.d.hp), 6);
    }
    if (g.player && g.player.painT > 0) {
      const p2 = g.portraitOf('gen:player', 3), pf = p2 && p2.big ? p2 : g.A.portraits.hero_pain;
      if (pf && pf.w) { ctx.globalAlpha = Math.min(1, g.player.painT * 3); frame(ctx, 12, 52, 52, 56, T); ctx.drawImage(pf.im, 38 - 24 * pf.w / pf.h, 55, 48 * pf.w / pf.h, 50); ctx.globalAlpha = 1; }
    }
    if (g.comboN > 1) {
      ctx.globalAlpha = Math.min(1, g.comboT * 2); ctx.font = F(900, 26); ctx.fillStyle = T.sys ? '#9fe4ff' : '#ffd23f'; ctx.textAlign = 'right';
      outlined(ctx, g.comboN + ' HIT', W - 16, g.mode === 'world' ? 164 : 112); ctx.globalAlpha = 1; ctx.textAlign = 'left';
    }
    if (this.hintT > 0) {
      ctx.globalAlpha = Math.min(1, this.hintT); ctx.font = F(600, 12); ctx.fillStyle = T.text; ctx.textAlign = 'center';
      outlined(ctx, '끝까지 밀면 달리기 · 달리며 공격하면 돌진 베기', W / 2, v.H * 0.3); ctx.globalAlpha = 1; ctx.textAlign = 'left';
    }
  }

  drawWorld() {
    const g = this.g, s = g.state; if (!s) return;
    this.topInfo(Math.round(s.money).toLocaleString('ko-KR') + '원 · 31층 D-' + Math.max(0, 365 - s.day) + (Settings.v.pk ? ' · PK' : ''));
    this.objective();
    this.combatBits(null);
    this.bars('world');
    this.drawToast();
  }

  drawPorter() {
    const g = this.g, v = g.view, ctx = v.ctx, s = g.state, T = this.T();
    this.topInfo('구급상자 ' + (s.inv.first_aid || 0) + ' · 회수 ' + g.porter.shards);
    const t1 = g.porter.floor.name + ' · 들꽃 파티 동행', t2 = g.goalText();
    ctx.font = F(700, 12); const w = Math.max(ctx.measureText(t1).width, ctx.measureText(t2).width) + 24;
    frame(ctx, v.W / 2 - w / 2, 10, w, 40, T);
    ctx.textAlign = 'center'; ctx.fillStyle = T.text; ctx.fillText(t1, v.W / 2, 26); ctx.fillStyle = T.dim; ctx.font = F(600, 11); ctx.fillText(t2, v.W / 2, 42); ctx.textAlign = 'left';
    this.bars('porter');
    this.drawToast();
  }

  draw() {
    const g = this.g, v = g.view, ctx = v.ctx, s = g.state, T = this.T(), W = v.W;
    this.topInfo((s.flags.masked !== false ? '정체 은닉 · ' : '') + '31층 D-' + Math.max(0, 365 - s.day) + (s.pts ? ' · 포인트 ' + s.pts : ''));
    if (g.floor) {
      const t1 = g.floor.name, t2 = g.goalText();
      ctx.font = F(700, 12); const w = Math.max(ctx.measureText(t1).width, ctx.measureText(t2).width) + 24;
      frame(ctx, W / 2 - w / 2, 10, w, 40, T);
      ctx.textAlign = 'center'; ctx.fillStyle = T.text; ctx.fillText(t1, W / 2, 26); ctx.fillStyle = T.dim; ctx.font = F(600, 11); ctx.fillText(t2, W / 2, 42); ctx.textAlign = 'left';
    }
    const B = g.boss;
    if (B && B.alive) {
      const w = Math.min(380, W * 0.5), x = W / 2 - w / 2, y = 54;
      frame(ctx, x, y, w, 26, T);
      ctx.font = F(800, 11); ctx.fillStyle = B.phase2 ? '#ff7a6a' : T.text; ctx.textAlign = 'left';
      ctx.fillText((B.phase2 ? '격분 · ' : '') + B.d.name, x + 8, y + 12);
      ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(x + 8, y + 16, w - 16, 6);
      ctx.fillStyle = B.phase2 ? '#ff4a3a' : '#e8433f'; ctx.fillRect(x + 8, y + 16, (w - 16) * Math.max(0, B.hp / B.d.hp), 6);
    }
    this.combatBits(B);
    this.bars('field');
    this.drawToast();
  }

  // ---------- 조작 ----------
  drawControls() {
    const g = this.g, ctx = g.view.ctx, inp = g.input, a = Settings.alpha(), T = this.T();
    for (const b of inp.buttons) {
      if (!b.top) continue;
      const on = inp.pressed[b.id];
      ctx.globalAlpha = 0.95;
      const ic = icon('icon_' + b.id, T), bs = skin(T.sys ? 'btn_top_sys' : 'btn_top');
      if (bs) { ctx.drawImage(bs.im, b.x - b.r, b.y - b.r, b.r * 2, b.r * 2); if (ic) ctx.drawImage(ic.im, b.x - b.r * 0.6, b.y - b.r * 0.6, b.r * 1.2, b.r * 1.2); else { ctx.fillStyle = T.text; ctx.textAlign = 'center'; ctx.font = F(800, 12); ctx.fillText(b.label, b.x, b.y + 4); ctx.textAlign = 'left'; } ctx.globalAlpha = 1; continue; }
      ctx.fillStyle = on ? T.act : T.bg; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
      ctx.save(); if (T.glow) { ctx.shadowColor = T.glow; ctx.shadowBlur = 6; } ctx.strokeStyle = T.sys ? T.line : T.accent; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
      ctx.fillStyle = T.text; ctx.textAlign = 'center'; ctx.font = F(800, b.label.length > 2 ? 9 : 14);
      ctx.fillText(b.label, b.x, b.y + (b.label.length > 2 ? 3 : 5)); ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    }
    if (g.talking || (g.menuOpen && !g.editBtns) || (g.mode === 'world' && g.ow.cut)) return;
    // 조이스틱 (방향 패드 모양)
    const j = inp.joy, base = inp.joyBase();
    if (Settings.v.joyMode === 'fixed' || j.id !== null) {
      const ox = j.id !== null ? j.ox : base.x, oy = j.id !== null ? j.oy : base.y, R = base.r;
      ctx.globalAlpha = a;
      const jb = skin(T.sys ? 'joy_base_sys' : 'joy_base'), jk = skin(T.sys ? 'joy_knob_sys' : 'joy_knob');
      if (jb && jk) {
        ctx.drawImage(jb.im, ox - R, oy - R, R * 2, R * 2);
        let kx = ox, ky = oy;
        if (j.id !== null) { const dx = j.x - ox, dy = j.y - oy, l = Math.hypot(dx, dy), m = Math.min(R * 0.6, l); if (l > 0) { kx = ox + dx / l * m; ky = oy + dy / l * m; } }
        ctx.drawImage(jk.im, kx - R * 0.4, ky - R * 0.4, R * 0.8, R * 0.8);
        ctx.globalAlpha = 1;
      } else {
      ctx.fillStyle = T.bg; ctx.beginPath(); ctx.arc(ox, oy, R, 0, Math.PI * 2); ctx.fill();
      ctx.save(); if (T.glow) { ctx.shadowColor = T.glow; ctx.shadowBlur = 8; } ctx.strokeStyle = T.sys ? T.line : 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      ctx.fillStyle = T.sys ? 'rgba(127,216,255,0.55)' : 'rgba(255,255,255,0.35)';
      for (let i = 0; i < 4; i++) {
        const an = i * Math.PI / 2, cx = ox + Math.cos(an) * R * 0.72, cy = oy + Math.sin(an) * R * 0.72, s = R * 0.16;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(an); ctx.beginPath(); ctx.moveTo(s, 0); ctx.lineTo(-s * 0.7, -s); ctx.lineTo(-s * 0.7, s); ctx.closePath(); ctx.fill(); ctx.restore();
      }
      let kx = ox, ky = oy;
      if (j.id !== null) { const dx = j.x - ox, dy = j.y - oy, l = Math.hypot(dx, dy), m = Math.min(R * 0.6, l); if (l > 0) { kx = ox + dx / l * m; ky = oy + dy / l * m; } }
      ctx.fillStyle = T.sys ? 'rgba(191,234,255,0.85)' : 'rgba(255,255,255,0.75)'; ctx.beginPath(); ctx.arc(kx, ky, R * 0.34, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      }
    }
    for (const b of inp.buttons) {
      if (b.top) continue;
      const on = inp.pressed[b.id];
      const isSk = /^skill\d$/.test(b.id);
      const dim = b.locked || (isSk && (g.state.mp || 0) < (b.cost || 0));
      ctx.globalAlpha = a * (dim ? 0.55 : 1);
      const bimg = skin((on ? 'btn_on' : b.id === 'act' ? 'btn_act' : 'btn') + (T.sys ? '_sys' : ''));
      if (bimg) {
        const rr2 = b.r * (on ? 0.93 : 1); ctx.drawImage(bimg.im, b.x - rr2, b.y - rr2, rr2 * 2, rr2 * 2);
        const ic = b.iconItem ? skin(b.iconItem) : icon('icon_' + (b.icon || b.id), T);
        ctx.textAlign = 'center';
        if (ic && !b.locked) {
          const withLabel = b.id === 'act' && b.label && b.icon !== 'act';
          const sz = b.r * (withLabel ? 0.9 : 1.05);
          ctx.drawImage(ic.im, b.x - sz / 2, b.y - sz / 2 - (withLabel ? b.r * 0.18 : 0), sz, sz);
          if (withLabel) { ctx.font = F(800, Math.max(9, Math.round(b.r * 0.26))); ctx.fillStyle = T.text; ctx.fillText(b.label, b.x, b.y + b.r * 0.62); }
        } else { ctx.fillStyle = T.text; ctx.font = F(800, Math.round(Math.max(10, b.r * 0.42))); ctx.fillText(b.locked ? '🔒' : b.label, b.x, b.y + b.r * 0.15); }
        if (b.sub !== undefined && !b.locked) { ctx.font = F(700, 9); ctx.fillStyle = T.accent; ctx.textAlign = 'center'; ctx.fillText('×' + b.sub, b.x, b.y + b.r * 0.62); }
        if (isSk && !b.locked) { ctx.font = F(800, 9); ctx.fillStyle = T.text; ctx.textAlign = 'center'; ctx.fillText(b.label, b.x, b.y + b.r + 11); }
        if (b.warn) { ctx.globalAlpha = 1; ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke(); }
        ctx.globalAlpha = 1; ctx.textAlign = 'left'; this.cdOverlay(ctx, b); continue;
      }
      ctx.fillStyle = on ? T.act : b.id === 'act' ? (T.sys ? 'rgba(20,70,120,0.8)' : 'rgba(120,60,30,0.78)') : T.bg;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (on ? 0.93 : 1), 0, Math.PI * 2); ctx.fill();
      ctx.save(); if (T.glow) { ctx.shadowColor = T.glow; ctx.shadowBlur = 8; } ctx.strokeStyle = T.sys ? T.line : T.accent; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      ctx.fillStyle = T.text; ctx.textAlign = 'center';
      ctx.font = F(800, Math.round(Math.max(10, b.r * 0.42)));
      ctx.fillText(b.locked ? '🔒' : b.label, b.x, b.y + b.r * 0.15);
      if (b.sub !== undefined && !b.locked) { ctx.font = F(700, 9); ctx.fillStyle = T.accent; ctx.fillText('×' + b.sub, b.x, b.y + b.r * 0.62); }
      if (b.cost && !b.locked) { ctx.font = F(700, 9); ctx.fillStyle = '#7fb8ff'; ctx.fillText('MP ' + b.cost, b.x, b.y + b.r * 0.66); }
      if (b.ult && !b.locked) { ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 3, 0, Math.PI * 2); ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.textAlign = 'left';
      this.cdOverlay(ctx, b);
    }
  }

  // 쿨타임: 어둡게 덮고 남은 초 표시
  cdOverlay(ctx, b) {
    if (!b.cd || b.cd <= 0 || !b.cdMax) return;
    const k = Math.min(1, b.cd / b.cdMax);
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.arc(b.x, b.y, b.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.font = F(900, Math.max(11, Math.round(b.r * 0.5))); ctx.textAlign = 'center';
    ctx.fillText(b.cd >= 1 ? Math.ceil(b.cd) : b.cd.toFixed(1), b.x, b.y + b.r * 0.2);
    ctx.restore();
  }

  // ---------- 대화 ----------
  drawDialogue(dlg) {
    const cur = dlg.cur; if (!cur) return;
    const g = this.g, v = g.view, ctx = v.ctx, W = v.W, H = v.H, T = this.T();
    const pf = cur.portrait ? g.portraitOf(cur.portrait, cur.emo) : null;
    const ph = H * 0.66;
    const pw = pf && pf.w ? (pf.big ? Math.min(W * 0.34, ph * pf.w / pf.h) : Math.min(H * 0.6, W * 0.28)) : 0;
    const bh = Math.min(96, H * 0.27), by = H - bh - 10, bx = 10, bw = W - 20 - (pw ? pw * 0.62 : 0);
    if (pf && pf.w) {
      ctx.imageSmoothingEnabled = false;
      if (pf.big) { ctx.imageSmoothingEnabled = true; ctx.drawImage(pf.im, W - pw - 2, H - pw * pf.h / pf.w, pw, pw * pf.h / pf.w); ctx.imageSmoothingEnabled = false; }
      else if (cur.portrait.startsWith('gen:')) ctx.drawImage(pf.im, W - pw - 6, H - pw - 4, pw, pw);
      else { const crop = 0.62, ph = pw * 1.1, pww = pf.w / (pf.h * crop) * ph; ctx.drawImage(pf.im, 0, 0, pf.w, pf.h * crop, W - pww - 4, H - ph - 4, pww, ph); }
    }
    frame(ctx, bx, by, bw, bh, T, 'dialog');
    if (cur.speaker) {
      ctx.font = F(800, 13); const nw = ctx.measureText(cur.speaker).width + 26;
      frame(ctx, bx + 8, by - 22, nw, 22, T);
      ctx.fillStyle = T.sys ? '#9fe4ff' : '#ffcf8a'; ctx.textAlign = 'center'; ctx.fillText(cur.speaker, bx + 8 + nw / 2, by - 6); ctx.textAlign = 'left';
    }
    ctx.fillStyle = T.text; ctx.font = F(500, 14);
    const shown = cur.text.slice(0, Math.floor(dlg.t * 32));
    wrap(ctx, shown, bw - 30).slice(0, 4).forEach((l, i) => ctx.fillText(l, bx + 16, by + 26 + i * 19));
    dlg.rects = [];
    if (dlg.typed() && cur.choices && cur.choices.length) {
      const n = cur.choices.length, cw = Math.min(330, bw * 0.75), ch = Math.min(34, (by - 30 - (n - 1) * 6) / n), gap = 6;
      let y = Math.max(8, by - 28 - (n * ch + (n - 1) * gap));
      const x = bx + 10;
      ctx.font = F(600, 13);
      for (const c of cur.choices) {
        frame(ctx, x, y, cw, ch, T);
        ctx.fillStyle = T.text; ctx.textAlign = 'left'; ctx.fillText('▸ ' + c.text, x + 12, y + ch / 2 + 5);
        dlg.rects.push({ x, y, w: cw, h: ch, c });
        y += ch + gap;
      }
    } else if (dlg.typed() && Math.floor(performance.now() / 400) % 2) {
      ctx.fillStyle = T.accent; ctx.font = F(800, 11); ctx.textAlign = 'right'; ctx.fillText('NEXT ▶', bx + bw - 12, by + bh - 10); ctx.textAlign = 'left';
    }
  }
}

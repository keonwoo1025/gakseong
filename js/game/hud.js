// 화면 정보: 체력·기력·경험치, 기한 시계, 콤보, 대화창.

function frame(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(28,22,16,0.84)'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.strokeStyle = 'rgba(201,162,74,0.35)'; ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);
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

export class HUD {
  constructor(g) { this.g = g; this.hintT = 0; this.toast = null; }

  say(text, t = 2.2) { this.toast = { text, t }; }
  update(dt) { this.hintT = Math.max(0, this.hintT - dt); if (this.toast) { this.toast.t -= dt; if (this.toast.t <= 0) this.toast = null; } }

  draw() {
    const g = this.g, v = g.view, ctx = v.ctx, s = g.state, p = g.player;
    const W = v.W, H = v.H, top = 12, left = 12;
    frame(ctx, left, top, 214, 62);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f3e3b5'; ctx.font = '700 13px system-ui,sans-serif';
    ctx.fillText(s.given, left + 12, top + 20);
    ctx.fillStyle = '#c9a24a'; ctx.font = '600 11px system-ui,sans-serif';
    ctx.fillText('Lv.' + s.lv, left + 14 + ctx.measureText(s.given).width + 30, top + 20);
    const bar = (y, h, k, bg, fg) => { ctx.fillStyle = bg; ctx.fillRect(left + 12, y, 190, h); ctx.fillStyle = fg; ctx.fillRect(left + 12, y, 190 * Math.max(0, Math.min(1, k)), h); };
    bar(top + 27, 8, s.hp / p.maxHp, '#3a1414', '#e8433f');
    bar(top + 38, 6, s.sp / 60, '#1a2236', '#4aa3ff');
    bar(top + 48, 4, s.exp / g.expNeed(), '#1f2a14', '#9fe07a');

    if (p.painT > 0) {
      const pf = g.A.portraits.hero_pain;
      if (pf && pf.w) { ctx.globalAlpha = Math.min(1, p.painT * 3); frame(ctx, left + 220, top, 58, 62); ctx.drawImage(pf.im, left + 249 - 27 * pf.w / pf.h, top + 5, 54 * pf.w / pf.h, 54); ctx.globalAlpha = 1; }
    }

    if (g.floor) {
      ctx.textAlign = 'center'; ctx.fillStyle = '#f3e3b5'; ctx.font = '700 13px system-ui,sans-serif';
      outlined(ctx, g.floor.name + (s.phase === 'porter' ? ' · 짐꾼 의뢰' : (s.flags.masked !== false ? ' · 정체 은닉' : '')), W / 2, 24);
      ctx.font = '600 12px system-ui,sans-serif';
      outlined(ctx, g.goalText(), W / 2, 42);
    }
    ctx.textAlign = 'right'; ctx.fillStyle = '#f3e3b5'; ctx.font = '700 13px system-ui,sans-serif';
    const dleft = Math.max(0, 365 - s.day);
    outlined(ctx, '31층 기한 D-' + dleft, W - 14, 62);
    ctx.font = '600 12px system-ui,sans-serif';
    outlined(ctx, '처치 ' + s.kills, W - 14, 80);
    if (s.pts > 0) { ctx.fillStyle = '#ffd23f'; outlined(ctx, '스탯 포인트 ' + s.pts, W - 14, 98); }

    if (g.comboN > 1) {
      ctx.globalAlpha = Math.min(1, g.comboT * 2); ctx.font = '900 28px system-ui,sans-serif'; ctx.fillStyle = '#ffd23f';
      outlined(ctx, g.comboN + ' HIT', W - 16, 132); ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'center';
    if (this.toast) {
      ctx.globalAlpha = Math.min(1, this.toast.t * 2); ctx.font = '800 18px system-ui,sans-serif'; ctx.fillStyle = '#ffd23f';
      outlined(ctx, this.toast.text, W / 2, H * 0.22); ctx.globalAlpha = 1;
    }
    if (this.hintT > 0) {
      ctx.globalAlpha = Math.min(1, this.hintT); ctx.font = '600 13px system-ui,sans-serif'; ctx.fillStyle = '#f3e3b5';
      outlined(ctx, '왼쪽을 끌어 이동, 끝까지 밀면 달리기, 오른쪽 탭은 공격, 밀면 회피', W / 2, H - 20); ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';

    const j = g.input.joy;
    if (j.id !== null) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(j.ox, j.oy, 50, 0, Math.PI * 2); ctx.stroke();
      const dx = j.x - j.ox, dy = j.y - j.oy, l = Math.min(50, Math.hypot(dx, dy)), a = Math.atan2(dy, dx);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(j.ox + Math.cos(a) * l, j.oy + Math.sin(a) * l, 18, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawDialogue(dlg) {
    const cur = dlg.cur; if (!cur) return;
    const v = this.g.view, ctx = v.ctx, W = v.W, H = v.H;
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, W, H);
    const bh = Math.min(108, H * 0.27), by = H - bh - 10, bx = 10, bw = W - 20;
    frame(ctx, bx, by, bw, bh);
    let tx = bx + 20;
    const pf = cur.portrait ? this.g.A.portraits[cur.portrait] : null;
    if (pf && pf.w) {
      const crop = 0.6, ph = bh * 1.28, pw = pf.w / (pf.h * crop) * ph;
      ctx.drawImage(pf.im, 0, 0, pf.w, pf.h * crop, bx + 10, by + bh - 4 - ph, pw, ph);
      tx = bx + pw + 26;
    }
    ctx.textAlign = 'left';
    if (cur.speaker) { ctx.fillStyle = '#ffcf5a'; ctx.font = '800 15px system-ui,sans-serif'; ctx.fillText(cur.speaker, tx, by + 28); }
    ctx.fillStyle = '#f6efe0'; ctx.font = '500 15px system-ui,sans-serif';
    const shown = cur.text.slice(0, Math.floor(dlg.t * 32));
    wrap(ctx, shown, bw - (tx - bx) - 20).forEach((l, i) => ctx.fillText(l, tx, by + (cur.speaker ? 52 : 34) + i * 21));
    dlg.rects = [];
    if (dlg.typed() && cur.choices && cur.choices.length) {
      const n = cur.choices.length, cw = Math.min(360, W * 0.6), ch = 40, gap = 8;
      const total = n * ch + (n - 1) * gap;
      let y = Math.max(20, by - 14 - total);
      const x = W / 2 - cw / 2;
      ctx.font = '600 14px system-ui,sans-serif'; ctx.textAlign = 'center';
      for (const c of cur.choices) {
        frame(ctx, x, y, cw, ch);
        ctx.fillStyle = '#f6efe0'; ctx.fillText(c.text, W / 2, y + 25);
        dlg.rects.push({ x, y, w: cw, h: ch, c });
        y += ch + gap;
      }
      ctx.textAlign = 'left';
    } else if (dlg.typed() && Math.floor(performance.now() / 400) % 2) {
      ctx.fillStyle = '#c9a24a'; ctx.beginPath();
      ctx.moveTo(bx + bw - 26, by + bh - 22); ctx.lineTo(bx + bw - 14, by + bh - 22); ctx.lineTo(bx + bw - 20, by + bh - 14); ctx.fill();
    }
  }
}

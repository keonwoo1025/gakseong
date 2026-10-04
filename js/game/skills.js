// 전설직 스킬: 패시브(여러 개), 전용 회피(직업 데이터), 액티브 4개. 디아블로2식 스킬 포인트로 습득·강화.
// 수치와 종류는 data/skills.json. 거리 단위는 타일(전투 맵 타일 폭 88px).
const T = 88;
const now = () => performance.now() / 1000;

export class Skills {
  constructor(g) { this.g = g; this.reset(); }

  reset() { this.timers = []; this.allies = []; this.marks = []; this.buffs = []; this.stacks = {}; this.shield = 0; this.shieldWait = 0; this.guardCd = 0; this.revived = false; }

  get def() { const s = this.g.state; return s && this.g.skills[s.job]; }
  lv(kind, i) { const L = this.g.state.sk; return L ? (L[kind][i] || 0) : 0; }
  ensure() {
    const s = this.g.state;
    if (!this.def) return;
    if (!s.sk) s.sk = { p: [1, 0, 0, 0, 0], a: [1, 0, 0, 0] };
    if (s.skp === undefined) s.skp = 0;
  }
  passiveReq(i) { return [1, 5, 10, 15, 20][i] || 25; }

  // 패시브 합계 (레벨마다 15%씩 강해짐)
  P(key) {
    const d = this.def; if (!d) return 0;
    let v = 0;
    d.passive.forEach((p, i) => {
      const L = this.lv('p', i); if (!L || !p.fx || p.fx[key] === undefined) return;
      const x = p.fx[key];
      v += typeof x === 'number' ? x * (1 + 0.15 * (L - 1)) : (x ? 1 : 0);
    });
    for (const b of this.buffs) if (b[key]) v += b[key];
    for (const k in this.stacks) { const st = this.stacks[k]; if (st.n && st.fx[key]) v += st.fx[key] * st.n; }
    return v;
  }

  onHit(e) {
    const d = this.def; if (!d) return;
    d.passive.forEach((p, i) => {
      if (!this.lv('p', i) || !p.fx) return;
      const st = p.fx.stack;
      if (st) { const o = this.stacks[st.key] || (this.stacks[st.key] = { n: 0, t: 0, fx: st }); o.n = Math.min(st.max, o.n + 1); o.t = st.decay; }
      if (p.fx.pado) e.pado = Math.min(5, (e.pado || 0) + 1);
      if (p.fx.slowOnHit) { e.slowK = Math.max(0.7, 1 - (e.slowN = Math.min(3, (e.slowN || 0) + 1)) * 0.1); e.slowT = 2; }
    });
    const ls = this.P('lifesteal');
    if (ls) { const s = this.g.state; s.hp = Math.min(this.g.maxHp(), s.hp + this.g.atkPower() * ls * 3); }
  }

  onKill(e) {
    const h = this.P('harvest');
    if (h && Math.random() < h && this.allies.filter((a) => a.kind === 'shadow').length < 5) this.spawnShadow(e.x, e.y, 10, 0.35);
  }

  // 피격 흡수: 대지 방어막, 성휘 보호
  absorb(v) {
    const g = this.g, s = g.state;
    if (this.shield > 0) {
      const a = Math.min(this.shield, v); this.shield -= a; v -= a;
      g.fx.num(g.player.x, g.player.y - 160, '흡수 ' + Math.round(a), 'dodge');
      if (this.shield <= 0) this.shieldWait = 4;
    }
    const gd = this.P('guard');
    if (gd && this.guardCd <= 0 && s.hp - v < g.maxHp() * 0.3) { this.shield += g.maxHp() * gd; this.guardCd = 10; g.fx.num(g.player.x, g.player.y - 170, '신성보호', 'skill'); }
    return v;
  }

  tryRevive() {
    if (this.revived || !this.P('revive')) return false;
    this.revived = true; const g = this.g; g.state.hp = g.maxHp() * 0.3;
    g.fx.sfx('aura', g.player.x, g.player.y - 40, { s: 2, fps: 16, ground: true }); g.fx.num(g.player.x, g.player.y - 160, '부활의 기적', 'skill');
    return true;
  }

  later(t, fn) { this.timers.push({ t, fn }); }

  // 스킬 이펙트 자리: assets 의 fx 묶음에 같은 이름(예: geomgang)이 생기면 그 그림을, 없으면 코드 이펙트를 쓴다
  vfx(name, x, y, o, fallback) {
    const fx = this.g.fx, frames = name && fx.frames(name);
    if (frames && frames.length && !frames[0].missing) fx.sfx(name, x, y, Object.assign({ fps: 16, s: 2 }, o));
    else if (fallback) fallback();
  }

  target(rangeT) {
    const p = this.g.player, v = this.g.view, hw = v.W / v.G / 2, hh = v.H / v.G / 2;
    let b = null, bd = rangeT * T + 40;
    for (const e of this.g.enemies.list) {
      if (!e.alive) continue;
      if (Math.abs(e.x - v.cam.x) > hw || Math.abs(e.y - v.cam.y) > hh) continue; // 화면 밖은 조준하지 않는다
      const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < bd) { bd = d; b = e; }
    }
    return b;
  }

  inRadius(x, y, r) { return this.g.enemies.list.filter((e) => e.alive && Math.hypot(e.x - x, e.y - y) < r); }

  hit(e, mult, sk, L, extra = {}) {
    const p = this.g.player, dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
    return p.strike(e, mult * (1 + 0.08 * (L - 1)), dx / d * (extra.kb || 300), dy / d * (extra.kb || 300), 2, extra.stun ?? 0.25, { skill: true, noMiss: sk.noMiss, critBonus: sk.critBonus, ignoreDef: sk.ignoreDef, executeB: sk.execute, behind: extra.behind });
  }

  cast(i) {
    const g = this.g, s = g.state, p = g.player, d = this.def;
    if (!d || !p || p.state === 'dead') return;
    const sk = d.active[i], L = this.lv('a', i);
    if (!sk) return;
    if (!L) { g.toast(`${sk.name}: LV.${sk.req}에 습득 가능`); return; }
    const key = 's' + i;
    if ((p.cds[key] || 0) > 0) return;
    if ((s.mp || 0) < sk.mp) { g.toast('MP가 부족하다'); return; }
    s.mp -= sk.mp; p.cds[key] = sk.cd * (1 - 0.02 * (L - 1)); p.cdMax = p.cdMax || {}; p.cdMax[key] = p.cds[key];
    p.state = 'skill'; p.t = 0; g.combatT = 0;
    if (sk.armor) p.armorT = sk.armor;
    const col = sk.color || '#fff';
    const tg = this.target(sk.range || 6);
    const DVv = { D: [0, 1], U: [0, -1], R: [1, 0], L: [-1, 0] }[p.dir];
    let ang = tg ? Math.atan2(tg.y - p.y, tg.x - p.x) : Math.atan2(DVv[1], DVv[0]);
    if (tg) p.dir = p.dirOf(tg.x - p.x, tg.y - p.y);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    g.fx.num(p.x, p.y - 150, sk.name, 'skill');
    g.sound.sfx(sk.ult ? 'heavy' : 'slash');
    if (sk.ult) { g.view.addShake(12); g.hitstop = 0.12; g.flashParry = 0.12; }
    const K = sk.kind;
    if (K === 'line') {
      const len = sk.range * T, w = sk.width * T;
      this.vfx(sk.fx, p.x + ca * len / 2, p.y - 40 + sa * len / 2, { rot: ang, s: len / 120 }, () => g.fx.beam(p.x + ca * 30, p.y - 40 + sa * 30, ang, len, w, col));
      for (const e of g.enemies.list) {
        if (!e.alive) continue;
        const rx = e.x - p.x, ry = e.y - p.y, al = rx * ca + ry * sa, sd = Math.abs(-rx * sa + ry * ca);
        if (al > -20 && al < len && sd < w / 2 + 24) this.hit(e, sk.dmg, sk, L);
      }
      if (sk.heal) s.hp = Math.min(g.maxHp(), s.hp + g.maxHp() * sk.heal * (1 + this.P('heal')));
    } else if (K === 'pull') {
      if (!tg) return;
      const dist = Math.hypot(tg.x - p.x, tg.y - p.y), mv = Math.min(sk.pull * T, Math.max(0, dist - 70));
      tg.x -= ca * mv; tg.y -= sa * mv; g.world.unstick(tg, 18);
      g.fx.beam(p.x, p.y - 40, ang, dist, 20, col);
      this.hit(tg, sk.dmg, sk, L, { stun: 0.6, kb: 40 });
    } else if (K === 'swords') {
      let left = sk.hits;
      const fire = () => {
        if (left <= 0) return;
        const e = this.target(sk.range);
        if (e) { left--; this.allies.push({ kind: 'sword', x: p.x, y: p.y - 120, tg: e, sp: 900, t: 0, life: 1.5, cb: () => this.hit(e, sk.dmg, sk, L, { kb: 120, stun: 0.12 }) }); }
      };
      for (let k = 0; k < sk.dur * sk.rate; k++) this.later(k / sk.rate, fire);
    } else if (K === 'rapid') {
      for (let k = 0; k < sk.shots; k++) this.later(k * sk.time / sk.shots, () => {
        const e = this.target(sk.range); if (!e) return;
        const a2 = Math.atan2(e.y - p.y, e.x - p.x);
        g.fx.beam(p.x, p.y - 50, a2, Math.hypot(e.x - p.x, e.y - p.y), 8, col);
        this.hit(e, sk.dmg, sk, L, { kb: 60, stun: 0.05 });
      });
    } else if (K === 'rain') {
      const cx = tg ? tg.x : p.x + ca * 4 * T, cy = tg ? tg.y : p.y + sa * 4 * T, R = sk.radius * T;
      this.marks.push({ x: cx, y: cy, r: R, t: 0, life: sk.time + 0.2, col });
      for (let k = 0; k < sk.shots; k++) this.later(k * sk.time / sk.shots, () => {
        const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * R, x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        g.fx.beam(x, y - 220, Math.PI / 2, 200, 6, col); g.fx.sfx('imp', x, y - 10, { s: 0.6, fps: 24 });
        for (const e of this.inRadius(x, y, 70)) this.hit(e, sk.dmg, sk, L, { kb: 40, stun: 0.05 });
      });
    } else if (K === 'root') {
      const cx = tg ? tg.x : p.x + ca * 3 * T, cy = tg ? tg.y : p.y + sa * 3 * T, R = sk.radius * T;
      this.vfx(sk.fx, cx, cy, { s: R / 50, ground: true }, () => g.fx.sfx('ring', cx, cy, { s: 3, fps: 14, ground: true }));
      for (const e of this.inRadius(cx, cy, R)) { e.rootT = sk.dur; this.hit(e, sk.dmg, sk, L, { kb: 0, stun: sk.dur }); }
    } else if (K === 'meteor') {
      const cx = tg ? tg.x : p.x + ca * 4 * T, cy = tg ? tg.y : p.y + sa * 4 * T, R = sk.radius * T;
      this.marks.push({ x: cx, y: cy, r: R, t: 0, life: sk.delay, col: '#ff6a3a' });
      this.later(sk.delay, () => {
        this.vfx(sk.fx, cx, cy - 40, { s: R / 50 }, () => { g.fx.sfx('imp', cx, cy - 40, { s: 3.2, fps: 16 }); g.fx.sfx('ring', cx, cy, { s: 4, fps: 14, ground: true }); }); g.view.addShake(10); g.sound.sfx('heavy');
        for (const e of this.inRadius(cx, cy, R)) this.hit(e, sk.dmg * (e.rootT > 0 ? 1 + sk.rootBonus : 1), sk, L, { kb: 420, stun: 0.6 });
      });
    } else if (K === 'quake') {
      const cx = p.x, cy = p.y, R = sk.radius * T;
      this.marks.push({ x: cx, y: cy, r: R, t: 0, life: sk.time, col });
      for (let k = 0; k < sk.ticks; k++) this.later(k * sk.time / sk.ticks, () => {
        g.view.addShake(6); g.fx.sfx('ring', cx, cy, { s: 5, fps: 14, ground: true });
        for (const e of this.inRadius(cx, cy, R)) { e.slowK = 0.5; e.slowT = 1; this.hit(e, sk.dmg / sk.ticks, sk, L, { kb: 60, stun: 0.15 }); }
      });
    } else if (K === 'multi') {
      const R = sk.radius * T;
      for (let k = 0; k < sk.hits; k++) this.later(k * sk.time / sk.hits, () => {
        const es = this.inRadius(p.x, p.y, R); if (!es.length) return;
        const e = es[k % es.length];
        g.fx.sfx('s2', e.x, e.y - 40, { s: 1.6, fps: 24, rot: Math.random() * 6.28 });
        this.hit(e, sk.dmg / sk.hits, sk, L, { kb: 80, stun: 0.1 });
      });
    } else if (K === 'blink') {
      let tx, ty, behind = false;
      if (tg && sk.behind) { const dx = tg.x - p.x, dy = tg.y - p.y, dd = Math.hypot(dx, dy) || 1; tx = tg.x + dx / dd * 60; ty = tg.y + dy / dd * 30; behind = true; }
      else { const v = g.input.vec(), m = Math.hypot(v[0], v[1]); const a2 = m > 0.1 ? Math.atan2(v[1], v[0]) : ang; tx = p.x + Math.cos(a2) * sk.range * T; ty = p.y + Math.sin(a2) * sk.range * T; }
      g.fx.sfx('ring', p.x, p.y, { s: 2, fps: 18, ground: true });
      p.x = Math.max(60, Math.min(g.world.w - 60, tx)); p.y = Math.max(120, Math.min(g.world.h - 60, ty)); g.world.unstick(p, 26);
      g.fx.sfx('ring', p.x, p.y, { s: 2, fps: 18, ground: true }); p.inv = Math.max(p.inv, 0.3);
      if (behind && tg.alive && sk.dmg) this.hit(tg, sk.dmg, sk, L, { behind: true, stun: 0.4 });
      if (sk.buff) this.buffs.push({ ...sk.buff, t: sk.buff.dur });
    } else if (K === 'army') {
      for (let k = 0; k < sk.count; k++) { const a = k / sk.count * Math.PI * 2; this.spawnShadow(p.x + Math.cos(a) * 70, p.y + Math.sin(a) * 40, sk.dur, sk.power * (1 + 0.08 * (L - 1))); }
    } else if (K === 'burst') {
      const R = sk.radius * T;
      this.vfx(sk.fx, p.x, p.y - 40, { s: R / 50 }, () => { g.fx.sfx('ring', p.x, p.y, { s: 5.5, fps: 14, ground: true }); g.fx.sfx('aura', p.x, p.y - 40, { s: 2.4, fps: 16, ground: true }); });
      for (const e of this.inRadius(p.x, p.y, R)) this.hit(e, sk.dmg * (sk.execute && e.hp < e.d.hp * 0.3 ? 1 + sk.execute : 1), sk, L, { kb: 380, stun: 0.5 });
      if (sk.heal) s.hp = Math.min(g.maxHp(), s.hp + g.maxHp() * sk.heal * (1 + this.P('heal')));
      if (sk.buff) this.buffs.push({ ...sk.buff, t: sk.buff.dur });
      for (const a of this.allies) if (a.kind === 'shadow') a.rage = 2;
    } else if (K === 'gather') {
      const cx = tg ? tg.x : p.x + ca * 3 * T, cy = tg ? tg.y : p.y + sa * 3 * T, R = sk.radius * T;
      this.marks.push({ x: cx, y: cy, r: R, t: 0, life: 0.5, col });
      for (const e of this.inRadius(cx, cy, R)) { e.x += (cx - e.x) * 0.8; e.y += (cy - e.y) * 0.8; g.world.unstick(e, 18); e.slowK = 1 - sk.slow; e.slowT = sk.dur; this.hit(e, sk.dmg, sk, L, { kb: 0, stun: 0.3 }); }
    } else if (K === 'freeze') {
      const R = sk.radius * T;
      this.marks.push({ x: p.x, y: p.y, r: R, t: 0, life: sk.dur, col, frozen: true });
      for (const e of this.inRadius(p.x, p.y, R)) { if (e.d.boss) { e.slowK = 0.2; e.slowT = sk.dur; } else { e.stun = sk.dur; e.st = 'idle'; } }
    } else if (K === 'heal') {
      const v = g.maxHp() * sk.amount * (1 + this.P('heal')); s.hp = Math.min(g.maxHp(), s.hp + v);
      this.vfx(sk.fx, p.x, p.y - 40, { s: 2 }, () => g.fx.sfx('aura', p.x, p.y - 40, { s: 1.6, fps: 16, ground: true })); g.fx.num(p.x, p.y - 130, '+' + Math.round(v), 'exp');
    } else if (K === 'ward') {
      this.buffs.push({ dr: sk.dr, t: sk.dur, ward: true });
    }
  }

  spawnShadow(x, y, life, power) { this.allies.push({ kind: 'shadow', x, y, t: 0, life, power, cd: Math.random() * 0.5 }); }

  update(dt) {
    const g = this.g, s = g.state;
    if (!this.def) return;
    for (const tm of this.timers) tm.t -= dt;
    const due = this.timers.filter((tm) => tm.t <= 0); this.timers = this.timers.filter((tm) => tm.t > 0);
    for (const tm of due) tm.fn();
    for (const k in this.stacks) { const st = this.stacks[k]; st.t -= dt; if (st.t <= 0) st.n = 0; }
    for (const b of this.buffs) b.t -= dt; this.buffs = this.buffs.filter((b) => b.t > 0);
    for (const m of this.marks) m.t += dt; this.marks = this.marks.filter((m) => m.t < m.life);
    this.guardCd = Math.max(0, this.guardCd - dt);
    const sh = this.P('shield');
    if (sh) {
      const max = g.maxHp() * sh;
      if (this.shieldWait > 0) this.shieldWait -= dt; else this.shield = Math.min(max, this.shield + g.maxHp() * 0.03 * dt);
    }
    for (const a of this.allies) {
      a.t += dt;
      if (a.kind === 'sword') {
        const e = a.tg; if (!e || !e.alive) { a.t = a.life; continue; }
        const dx = e.x - a.x, dy = e.y - 40 - a.y, d = Math.hypot(dx, dy) || 1; a.ang = Math.atan2(dy, dx);
        const m = Math.min(d, a.sp * dt); a.x += dx / d * m; a.y += dy / d * m;
        if (d < 20) { g.fx.sfx('sw', e.x, e.y - 30, { s: 1, fps: 16 }); a.cb(); a.t = a.life; }
      } else if (a.kind === 'shadow') {
        a.cd -= dt * (a.rage ? 2 : 1); if (a.rage) a.rage = Math.max(0, a.rage - dt);
        let b = null, bd = 520;
        for (const e of g.enemies.list) { if (!e.alive) continue; const d = Math.hypot(e.x - a.x, e.y - a.y); if (d < bd) { bd = d; b = e; } }
        if (b) {
          const dx = b.x - a.x, dy = b.y - a.y, d = bd || 1;
          if (d > 50) { a.x += dx / d * 240 * dt; a.y += dy / d * 240 * dt; }
          else if (a.cd <= 0) { a.cd = 0.8; g.fx.sfx('s1', b.x, b.y - 40, { s: 1.1, fps: 24, rot: Math.random() * 6 }); g.player.strike(b, a.power, dx / d * 80, dy / d * 80, 0, 0.05, { skill: true }); }
        } else { const p = g.player; a.x += (p.x - a.x) * dt; a.y += (p.y - 40 - a.y) * dt; }
      }
    }
    this.allies = this.allies.filter((a) => a.t < a.life);
  }

  draw() {
    const g = this.g, ctx = g.view.ctx, T2 = performance.now() / 1000;
    for (const m of this.marks) {
      const k = m.t / m.life;
      ctx.save(); ctx.globalAlpha = m.frozen ? 0.25 : 0.35 * (1 - k * 0.5);
      ctx.fillStyle = m.col; ctx.beginPath(); ctx.ellipse(m.x, m.y, m.r, m.r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.9; ctx.strokeStyle = m.col; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(m.x, m.y, m.r * (m.frozen ? 1 : k), m.r * 0.5 * (m.frozen ? 1 : k), 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    const f = g.A.weapons.flying_sword[0];
    for (const a of this.allies) {
      if (a.kind === 'sword') {
        ctx.save(); ctx.translate(a.x, a.y); ctx.rotate((a.ang || 0) + Math.PI / 2);
        ctx.fillStyle = 'rgba(200,30,45,0.35)'; ctx.beginPath(); ctx.ellipse(0, 0, 13, 30, 0, 0, Math.PI * 2); ctx.fill();
        if (f && f.w) ctx.drawImage(f.im, -f.w * 0.35, -f.h * 0.35, f.w * 0.7, f.h * 0.7);
        ctx.restore();
      } else if (a.kind === 'shadow') {
        const fade = Math.min(1, a.t * 3, (a.life - a.t) * 2);
        ctx.save(); ctx.globalAlpha = 0.85 * fade;
        ctx.fillStyle = 'rgba(30,10,50,0.5)'; ctx.beginPath(); ctx.ellipse(a.x, a.y, 24, 9, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1a0f28'; ctx.beginPath(); ctx.ellipse(a.x, a.y - 40, 18, 40 + Math.sin(T2 * 6 + a.x) * 2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(a.x, a.y - 86, 15, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#b48cff'; ctx.fillRect(a.x - 7, a.y - 89, 4, 3); ctx.fillRect(a.x + 3, a.y - 89, 4, 3);
        ctx.restore();
      }
    }
    const p = g.player;
    if (p && (this.shield > 1 || this.buffs.some((b) => b.ward))) {
      ctx.save(); ctx.globalAlpha = 0.35 + Math.sin(T2 * 5) * 0.08;
      ctx.strokeStyle = this.buffs.some((b) => b.ward) ? '#ffe9a8' : '#c8a060'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(p.x, p.y - 50, 50, 70, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
  }
}

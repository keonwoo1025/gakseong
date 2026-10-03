// 주인공: 이동, 달리기, 3단 콤보, 회피, 피격, 쓰러짐, 비검.

const STG = [
  { fps: 18, hit: 1, d: [10, 14], r: 58, lunge: 12, shake: 0, stop: 0.03, kb: 160, seq: { D: [0, 2], R: [0, 1], U: [0, 0] }, set: 's1', sc: 1.9, sfps: 22, big: 0 },
  { fps: 16, hit: 1, d: [15, 20], r: 70, lunge: 26, shake: 3, stop: 0.05, kb: 240, seq: { D: [2, 3], R: [2, 3], U: [0, 0] }, set: 's2', sc: 2.1, sfps: 20, big: 1 },
  { fps: 13, hit: 3, d: [30, 40], r: 96, lunge: 70, shake: 9, stop: 0.11, kb: 520, seq: { D: [1, 1, 1, 2, 3, 3], R: [0, 0, 0, 1, 2, 3], U: [0, 0, 0, 0, 0, 0] }, set: 's3', sc: 2.9, sfps: 16, big: 2 },
];
const ROT = {
  s1: { D: 0, U: Math.PI, R: -Math.PI / 2, L: Math.PI / 2 },
  s2: { D: 0, U: Math.PI, R: -Math.PI / 2, L: Math.PI / 2 },
  s3: { D: -Math.PI / 2, U: Math.PI / 2, R: 0, L: 0 },
};
const DV = { D: [0, 1], U: [0, -1], R: [1, 0], L: [-1, 0] };
const CS = 0.8;

export class Player {
  constructor(g, x, y) {
    this.g = g; this.S = g.A.sprites.player;
    this.x = x; this.y = y;
    this.dir = 'D'; this.lastH = 1;
    this.state = 'idle'; this.t = 0; this.wf = 0;
    this.inv = 0; this.stage = 0; this.lastStage = -1; this.chain = 0; this.queued = false; this.hitDone = false;
    this.running = false; this.dust = 0; this.painT = 0; this.blink = 0;
    this.swords = g.jobs[g.state.job] && g.jobs[g.state.job].swords ? [0, 1, 2].map((i) => ({ x, y: y - 150, st: 'orbit', cd: 1 + i * 0.5, tg: null, ang: -Math.PI / 2, hist: [] })) : [];
  }

  get s() { return this.g.state; }
  get maxHp() { const s = this.s; return 100 + s.stats.vit * 10 + (s.lv - 1) * 5 + this.g.equipStat('hp'); }
  get job() { return this.g.jobs[this.s.job] || {}; }
  dmgMult() {
    const job = this.job;
    const main = job.main || ['str'];
    let sum = 0; for (const k of main) sum += this.s.stats[k] || 0;
    return (job.dmgBase || 1) * (1 + sum * 0.03);
  }

  dirOf(x, y) { if (Math.abs(x) > Math.abs(y) * 0.9) return x > 0 ? 'R' : 'L'; return y > 0 ? 'D' : 'U'; }

  nearest(range) {
    let b = null, bd = range;
    for (const e of this.g.enemies.list) { if (!e.alive) continue; const d = Math.hypot(e.x - this.x, e.y - this.y); if (d < bd) { bd = d; b = e; } }
    return b;
  }

  autoFace() {
    const b = this.nearest(200);
    if (b) this.dir = this.dirOf(b.x - this.x, b.y - this.y);
    if (this.dir === 'R') this.lastH = 1; if (this.dir === 'L') this.lastH = -1;
  }

  attack() {
    if (['dodge', 'hurt', 'dead'].includes(this.state)) return;
    if (this.state === 'attack') { if (this.t > 0.06) this.queued = true; return; }
    this.autoFace();
    this.stage = this.chain > 0 && this.lastStage >= 0 && this.lastStage < 2 ? this.lastStage + 1 : 0;
    this.state = 'attack'; this.t = 0; this.hitDone = false; this.queued = false; this.auraDone = false;
  }

  dodge(dx, dy) {
    if (this.state === 'dead') return;
    const l = Math.hypot(dx, dy);
    if (l < 0.01) { [dx, dy] = DV[this.dir]; } else { dx /= l; dy /= l; }
    if (Math.abs(dx) > 0.2) this.lastH = dx > 0 ? 1 : -1;
    this.state = 'dodge'; this.t = 0; this.dx = dx; this.dy = dy; this.inv = Math.max(this.inv, 0.4);
  }

  hurt(v, fx, fy) {
    if (this.inv > 0 || this.state === 'dead') return;
    const s = this.s;
    s.hp = Math.max(0, s.hp - v);
    this.inv = 0.9;
    this.g.fx.num(this.x, this.y - 140, v, 'hurt');
    if (s.hp <= 0) { this.state = 'dead'; this.t = 0; this.painT = 3; this.g.onPlayerDeath(); return; }
    this.state = 'hurt'; this.t = 0; this.dx = fx; this.dy = fy; this.heavy = v >= 8;
    if (this.heavy || s.hp < this.maxHp * 0.3) this.painT = 1.3;
  }

  update(dt) {
    const g = this.g, w = g.world, s = this.s;
    this.inv = Math.max(0, this.inv - dt); this.painT = Math.max(0, this.painT - dt); this.chain = Math.max(0, this.chain - dt);
    this.blink -= dt; if (this.blink < -3) this.blink = 0.15;
    const v = g.input.vec(), mag = Math.hypot(v[0], v[1]);

    if (this.state === 'idle' || this.state === 'walk') {
      if (mag > 0.15) {
        this.running = mag > 0.82 || g.input.running();
        const sp = this.running ? 390 : 230 * Math.min(1, mag * 1.25);
        const ox = this.x, oy = this.y;
        w.moveBody(this, v[0] * sp * dt, v[1] * sp * dt, 26);
        this.dir = this.dirOf(v[0], v[1]);
        if (this.dir === 'R') this.lastH = 1; if (this.dir === 'L') this.lastH = -1;
        this.state = 'walk';
        const md = Math.hypot(this.x - ox, this.y - oy);
        this.wf += md;
        if (this.running) { this.dust += md; if (this.dust > 85) { this.dust = 0; g.fx.sfx('dust', this.x - v[0] * 20, this.y + 4, { s: 0.75, fps: 14, ground: true, flip: v[0] < 0 }); } }
        if (this.running) g.recordPattern('은밀', dt * 0.02);
      } else { this.state = 'idle'; this.running = false; }
    } else if (this.state === 'attack') {
      this.t += dt;
      const st = STG[this.stage];
      const key = this.dir === 'L' ? 'R' : this.dir;
      const n = st.seq[key].length;
      const f = Math.floor(this.t * st.fps);
      const vv = DV[this.dir];
      const basic = !!this.job.basicFx;
      if (this.stage === 2 && !this.auraDone && !basic) { this.auraDone = true; g.fx.sfx('aura', this.x, this.y - 40, { s: 1.5, fps: 18, ground: true }); }
      if (f <= st.hit && f >= st.hit - 1) w.moveBody(this, vv[0] * st.lunge * st.fps * dt / 1.5, vv[1] * st.lunge * st.fps * dt / 1.5, 26);
      if (!this.hitDone && f >= st.hit) {
        this.hitDone = true;
        const flip = this.stage === 1 || (this.stage === 2 && this.dir === 'R');
        if (basic) g.fx.sfx('s1', this.x + vv[0] * 50, this.y + vv[1] * 36 - 50, { s: 1.3, fps: 22, rot: ROT.s1[this.dir], flip: this.stage === 1 });
        else g.fx.sfx(st.set, this.x + vv[0] * 55, this.y + vv[1] * 40 - 50, { s: st.sc, fps: st.sfps, rot: ROT[st.set][this.dir], flip });
        if (st.big === 2 && !basic) g.fx.sfx('ring', this.x + vv[0] * 60, this.y + vv[1] * 45, { s: 3.2, fps: 16, ground: true });
        let any = false;
        const mult = this.dmgMult();
        for (const e of g.enemies.list) {
          if (!e.alive) continue;
          const dx = e.x - this.x, dy = e.y - this.y, d = Math.hypot(dx, dy) || 1;
          if (d < st.r * 1.9 && (dx * vv[0] + dy * vv[1]) / d > (st.big === 2 ? -0.5 : -0.15)) {
            any = true;
            const dmg = Math.round((st.d[0] + Math.random() * (st.d[1] - st.d[0]) + g.equipStat('atk')) * mult);
            g.enemies.damage(e, dmg, vv[0] * st.kb + dx / d * st.kb * 0.3, vv[1] * st.kb + dy / d * st.kb * 0.3, st.big);
          }
        }
        if (any) { g.hitstop = basic ? st.stop * 0.5 : st.stop; g.combo(); g.recordPattern('공격', 0.05); }
        if (st.shake) g.view.addShake(basic ? st.shake * 0.4 : st.shake);
        if (st.big === 2) { const b = this.nearest(500); if (b) for (const sw of this.swords) { sw.tg = b; sw.st = 'atk'; } }
      }
      if (f >= n) {
        this.lastStage = this.stage; this.chain = 0.45;
        if (this.queued && this.stage < 2) { this.stage++; this.t = 0; this.hitDone = false; this.queued = false; this.auraDone = false; this.autoFace(); }
        else { if (this.stage === 2) this.chain = 0; this.state = 'idle'; }
      }
    } else if (this.state === 'dodge') {
      this.t += dt; const D = 0.34, k = 1 - this.t / D;
      w.moveBody(this, this.dx * 640 * k * dt, this.dy * 640 * k * dt, 26);
      if (Math.random() < 0.7) g.fx.list.push({ ghost: true, x: this.x, y: this.y, f: Math.min(3, Math.floor(this.t / D * 4)), fl: this.lastH < 0, t: 0, n: 1, fps: 2.5, set: '_ghost' });
      if (this.t >= D) this.state = 'idle';
    } else if (this.state === 'hurt') {
      this.t += dt; const D = this.heavy ? 0.45 : 0.25;
      const k = Math.max(0, 1 - this.t / D);
      w.moveBody(this, this.dx * (this.heavy ? 340 : 200) * k * dt, this.dy * (this.heavy ? 340 : 200) * k * dt, 26);
      if (this.t > D) this.state = 'idle';
    } else if (this.state === 'dead') {
      this.t += dt;
    }
    this.updateSwords(dt);
  }

  updateSwords(dt) {
    const T = performance.now() / 1000;
    for (let i = 0; i < this.swords.length; i++) {
      const sw = this.swords[i];
      const a = T * 2.3 + i * Math.PI * 2 / 3;
      const ox = this.x + Math.cos(a) * 52, oy = this.y - 150 + Math.sin(a) * 14;
      if (sw.st === 'orbit') {
        sw.x += (ox - sw.x) * Math.min(1, dt * 9); sw.y += (oy - sw.y) * Math.min(1, dt * 9); sw.ang = -Math.PI / 2;
        sw.cd -= dt;
        if (sw.cd <= 0 && this.state !== 'dead') { const b = this.nearest(400); if (b) { sw.tg = b; sw.st = 'atk'; } else sw.cd = 0.3; }
      } else if (sw.st === 'atk') {
        const e = sw.tg;
        if (!e.alive) sw.st = 'ret';
        else {
          const dx = e.x - sw.x, dy = e.y - 30 - sw.y, d = Math.hypot(dx, dy) || 1;
          sw.ang = Math.atan2(dy, dx);
          const m = Math.min(d, 700 * dt); sw.x += dx / d * m; sw.y += dy / d * m;
          if (d < 16) {
            this.g.fx.sfx('sw', e.x, e.y - 30, { s: 1.1, fps: 14 });
            this.g.enemies.damage(e, Math.round((6 + Math.random() * 4) * this.dmgMult()), dx / d * 80, dy / d * 80, -1);
            sw.st = 'ret';
          }
        }
      } else {
        const dx = ox - sw.x, dy = oy - sw.y, d = Math.hypot(dx, dy) || 1;
        sw.ang = Math.atan2(dy, dx);
        const m = Math.min(d, 560 * dt); sw.x += dx / d * m; sw.y += dy / d * m;
        if (d < 8) { sw.st = 'orbit'; sw.cd = 0.6 + Math.random() * 0.8; }
      }
      sw.hist.unshift([sw.x, sw.y]); if (sw.hist.length > 8) sw.hist.pop();
    }
  }

  frame() {
    const S = this.S, fl = this.dir === 'L', side = this.dir === 'L' || this.dir === 'R';
    if (this.state === 'dead') {
      const t = this.t;
      if (t < 0.4) return [S.fall[Math.min(S.fall.length - 1, Math.floor(t * 10))], this.lastH < 0, 0];
      return [S.lie[0], this.lastH < 0, 0];
    }
    if (this.state === 'hurt') {
      const arr = side ? S.hurtR : S.hurtD;
      const seq = this.heavy ? (side ? [2, 3, 4] : [2, 3, 3]) : [0, 1];
      return [arr[seq[Math.min(seq.length - 1, Math.floor(this.t / (this.heavy ? 0.15 : 0.125)))]], side && this.lastH < 0, 0];
    }
    if (this.state === 'dodge') return [S.dodge[Math.min(3, Math.floor(this.t / 0.34 * 4))], this.lastH < 0, 0];
    if (this.state === 'attack') {
      const st = STG[this.stage], key = this.dir === 'L' ? 'R' : this.dir;
      const arr = key === 'D' ? S.atkD : key === 'U' ? S.atkU : S.atkR;
      const seq = st.seq[key];
      const i = Math.min(seq.length - 1, Math.floor(this.t * st.fps));
      const lift = this.stage === 2 && i < 3 ? -Math.min(1, this.t * st.fps / 3) * 6 : 0;
      return [arr[Math.min(arr.length - 1, seq[i])], fl, lift];
    }
    if (this.state === 'walk' && this.running) {
      const arr = this.dir === 'U' ? S.runU : this.dir === 'D' ? S.runD : S.runR;
      const per = (side ? 330 : 210) / arr.length;
      return [arr[Math.floor(this.wf / per) % arr.length], fl, 0];
    }
    if (this.state === 'walk') {
      const arr = this.dir === 'U' ? S.walkU : this.dir === 'D' ? S.walkD : S.walkR;
      const per = 150 / arr.length, i = Math.floor(this.wf / per) % arr.length;
      const bob = !side ? -Math.abs(Math.sin(this.wf / per * Math.PI)) * 4 : 0;
      return [arr[i], fl, bob];
    }
    if (this.s.hp < this.maxHp * 0.3 && this.dir !== 'U') {
      const arr = side ? S.lowR : S.lowD;
      return [arr[Math.floor(performance.now() / 160) % arr.length], fl, 0];
    }
    const id = this.dir === 'U' ? S.idleU[0] : this.dir === 'D' ? (this.blink > 0 ? S.idleD[1] : S.idleD[0]) : S.idleR[0];
    return [id, fl, Math.sin(performance.now() / 400) * 1.2];
  }

  collect(list) {
    const v = this.g.view, S = this.S;
    for (const f of this.g.fx.list) if (f.ghost) list.push({ y: this.y - 1, d: () => v.sprite(S.dodge[f.f], f.x, f.y, CS, f.fl, 0.3 * (1 - f.t / 0.4)) });
    list.push({ y: this.y, d: () => {
      v.shadow(this.x, this.y, 30);
      const [f, fl, bob] = this.frame();
      const a = this.inv > 0 && this.state !== 'dodge' && Math.floor(this.inv * 14) % 2 ? 0.4 : 1;
      v.sprite(f, this.x, this.y + bob, CS, fl, a);
    } });
  }

  drawSwords() {
    const ctx = this.g.view.ctx, f = this.g.A.weapons.flying_sword[0];
    for (const sw of this.swords) {
      if (sw.st !== 'orbit') {
        ctx.strokeStyle = 'rgba(190,25,40,0.6)'; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath(); sw.hist.forEach((h, i) => (i ? ctx.lineTo(h[0], h[1]) : ctx.moveTo(h[0], h[1]))); ctx.stroke();
      }
      ctx.save(); ctx.translate(sw.x, sw.y); ctx.rotate(sw.ang + Math.PI / 2);
      ctx.fillStyle = 'rgba(200,30,45,0.3)'; ctx.beginPath(); ctx.ellipse(0, 0, 13, 30, 0, 0, Math.PI * 2); ctx.fill();
      if (f && f.w) ctx.drawImage(f.im, -f.w * 0.35, -f.h * 0.35, f.w * 0.7, f.h * 0.7);
      ctx.restore();
    }
  }
}

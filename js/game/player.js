// 주인공 (탑 전투): 이동, 달리기, 콤보(data/combos.json), 돌진 베기, 직업별 회피, 첫 번째 액티브, 피격, 쓰러짐.
// 기본 공격은 짧은 움찔만 주고, 강한 기절은 패링과 스킬에서만 생긴다.

const ROT = {
  s1: { D: 0, U: Math.PI, R: -Math.PI / 2, L: Math.PI / 2 },
  s2: { D: 0, U: Math.PI, R: -Math.PI / 2, L: Math.PI / 2 },
  s3: { D: -Math.PI / 2, U: Math.PI / 2, R: 0, L: 0 },
};
const DV = { D: [0, 1], U: [0, -1], R: [1, 0], L: [-1, 0] };
const CS = 0.8;
const now = () => performance.now() / 1000;

export class Player {
  constructor(g, x, y) {
    this.g = g; this.S = g.A.sprites.player;
    this.x = x; this.y = y;
    this.dir = 'D'; this.lastH = 1;
    this.state = 'idle'; this.t = 0; this.wf = 0;
    this.inv = 0; this.stage = 0; this.lastStage = -1; this.chain = 0; this.queued = false; this.hitDone = false;
    this.running = false; this.dust = 0; this.painT = 0; this.blink = 0;
    this.cds = { dodge: 0, skill1: 0 };
    this.lastHitT = -9; this.lastHitDir = [0, 1];
    this.swords = [];
  }

  get s() { return this.g.state; }
  get maxHp() { return this.g.maxHp(); }
  get job() { return this.g.jobs[this.s.job] || this.g.jobs['미각성']; }
  get combo() { return this.g.combos[this.job.combo || 'base3']; }
  get dg() { return this.job.dodge || this.g.jobs['미각성'].dodge; }
  get aspd() { return this.g.aspd(); }
  dmgMult() { return this.g.atkPower() / 15; }

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

  // 적중 판정: 회피율, 패링, 피해
  strike(e, mult, kx, ky, kind, flinch) {
    const g = this.g;
    g.combatT = 0;
    if (e.st === 'atk' && !e.hitDone || (e.st === 'wind' && e.stt > e.windT - 0.12)) { g.parry(e); }
    if (!g.rollHit(e)) { g.fx.num(e.x, e.y - 70, 'MISS', 'miss'); return false; }
    const dmg = Math.round(g.atkPower() * mult * (0.9 + Math.random() * 0.2));
    g.enemies.damage(e, dmg, kx, ky, kind, flinch);
    return true;
  }

  attack() {
    if (['dodge', 'hurt', 'dead', 'dash', 'skill'].includes(this.state)) return;
    if (this.state === 'walk' && this.running) {
      this.state = 'dash'; this.t = 0; this.dashHit = new Set(); this.inv = Math.max(this.inv, 0.25);
      const v = this.g.input.vec(), l = Math.hypot(v[0], v[1]) || 1;
      this.dx = l > 0.1 ? v[0] / l : DV[this.dir][0]; this.dy = l > 0.1 ? v[1] / l : DV[this.dir][1];
      this.g.fx.sfx('s2', this.x + this.dx * 60, this.y + this.dy * 40 - 50, { s: 2.2, fps: 22, rot: Math.atan2(this.dy, this.dx) - Math.PI / 2 });
      this.g.sound.sfx('slash');
      return;
    }
    if (this.state === 'attack') { if (this.t > 0.05) this.queued = true; return; }
    this.autoFace();
    this.stage = this.chain > 0 && this.lastStage >= 0 && this.lastStage < this.combo.length - 1 ? this.lastStage + 1 : 0;
    this.state = 'attack'; this.t = 0; this.hitDone = false; this.queued = false; this.auraDone = false;
  }

  dodge(dx, dy) {
    if (this.state === 'dead' || this.cds.dodge > 0) return;
    const l = Math.hypot(dx, dy);
    if (l < 0.01) { const v = this.g.input.vec(); if (Math.hypot(v[0], v[1]) > 0.1) { const m = Math.hypot(v[0], v[1]); dx = v[0] / m; dy = v[1] / m; } else [dx, dy] = DV[this.dir]; } else { dx /= l; dy /= l; }
    if (Math.abs(dx) > 0.2) this.lastH = dx > 0 ? 1 : -1;
    const d = this.dg;
    this.state = 'dodge'; this.t = 0; this.dx = dx; this.dy = dy; this.inv = Math.max(this.inv, d.inv);
    this.cds.dodge = d.cd; this.dodgeHit = new Set();
    this.g.sound.sfx('dodge');
    this.g.fx.sfx('dust', this.x, this.y + 4, { s: 1.1, fps: 16, ground: true });
    this.g.fx.num(this.x, this.y - 130, d.name, 'dodge');
  }

  skill() {
    const g = this.g, s = this.s, sk = this.job.skill1;
    if (!sk || this.state === 'dead') return;
    if (this.cds.skill1 > 0) return;
    if (s.mp < sk.mp) { g.toast('MP가 부족하다'); return; }
    s.mp -= sk.mp; this.cds.skill1 = sk.cd;
    const tg = this.nearest(sk.range + 40);
    let ang = Math.atan2(DV[this.dir][1], DV[this.dir][0]);
    if (tg) { ang = Math.atan2(tg.y - this.y, tg.x - this.x); this.dir = this.dirOf(tg.x - this.x, tg.y - this.y); }
    this.state = 'skill'; this.t = 0;
    const col = this.job.color || '#ffffff';
    g.view.addShake(6); g.hitstop = 0.06; g.sound.sfx('heavy');
    const ca = Math.cos(ang), sa = Math.sin(ang);
    let n = 0;
    for (const e of g.enemies.list) {
      if (!e.alive) continue;
      const rx = e.x - this.x, ry = e.y - 30 - (this.y - 30);
      let ok;
      if (sk.kind === 'burst') ok = Math.hypot(rx, ry) < sk.range;
      else { const along = rx * ca + ry * sa, side = Math.abs(-rx * sa + ry * ca); ok = along > -20 && along < sk.range && side < sk.width / 2 + 20; }
      if (ok && this.strike(e, sk.dmg, ca * 380, sa * 380, 2, 0.5)) n++;
    }
    if (sk.kind === 'burst') g.fx.sfx('ring', this.x, this.y, { s: 4, fps: 16, ground: true });
    else g.fx.beam(this.x + ca * 30, this.y - 40 + sa * 30, ang, sk.range, sk.width, col);
    if (sk.heal) s.hp = Math.min(this.maxHp, s.hp + this.maxHp * sk.heal);
    g.fx.num(this.x, this.y - 150, sk.name, 'skill');
  }

  hurt(v, fx, fy) {
    if (this.inv > 0 || this.state === 'dead' || this.state === 'dash' || this.state === 'dodge') return;
    const s = this.s;
    v = Math.max(1, Math.round(v * this.g.dmgTaken()));
    s.hp = Math.max(0, s.hp - v);
    this.g.combatT = 0;
    this.g.sound.sfx('hurt');
    this.g.fx.num(this.x, this.y - 140, v, 'hurt');
    if (this.state === 'attack' && this.stage === this.combo.length - 1 && s.hp > 0) { this.inv = 0.4; return; }
    this.inv = 0.8;
    if (s.hp <= 0) { this.state = 'dead'; this.t = 0; this.painT = 3; this.g.onPlayerDeath(); return; }
    this.state = 'hurt'; this.t = 0; this.dx = fx; this.dy = fy; this.heavy = v >= 10;
    if (this.heavy || s.hp < this.maxHp * 0.3) this.painT = 1.3;
  }

  update(dt) {
    const g = this.g, w = g.world, s = this.s;
    w.unstick(this, 26);
    this.inv = Math.max(0, this.inv - dt); this.painT = Math.max(0, this.painT - dt); this.chain = Math.max(0, this.chain - dt);
    for (const k in this.cds) this.cds[k] = Math.max(0, this.cds[k] - dt);
    this.blink -= dt; if (this.blink < -3) this.blink = 0.15;
    const v = g.input.vec(), mag = Math.hypot(v[0], v[1]);

    if (this.state === 'idle' || this.state === 'walk') {
      if (mag > 0.15) {
        this.running = g.input.running();
        const sp = (this.running ? 330 : 210 * Math.min(1, 0.45 + mag)) * g.moveMult();
        const ox = this.x, oy = this.y;
        w.moveBody(this, v[0] * sp * dt, v[1] * sp * dt, 26);
        this.dir = this.dirOf(v[0], v[1]);
        if (this.dir === 'R') this.lastH = 1; if (this.dir === 'L') this.lastH = -1;
        this.state = 'walk';
        const md = Math.hypot(this.x - ox, this.y - oy);
        this.wf += md;
        if (this.running) { this.dust += md; if (this.dust > 85) { this.dust = 0; g.fx.sfx('dust', this.x - v[0] * 20, this.y + 4, { s: 0.75, fps: 14, ground: true, flip: v[0] < 0 }); } }
      } else { this.state = 'idle'; this.running = false; }
    } else if (this.state === 'attack') {
      this.t += dt;
      const st = this.combo[this.stage], key = this.dir === 'L' ? 'R' : this.dir;
      const n = st.seq[key].length, fps = st.fps * this.aspd;
      const f = Math.floor(this.t * fps);
      const vv = DV[this.dir];
      if (st.aura && !this.auraDone) { this.auraDone = true; g.fx.sfx('aura', this.x, this.y - 40, { s: 1.4, fps: 18, ground: true }); }
      if (f <= st.hit && f >= st.hit - 1) w.moveBody(this, vv[0] * st.lunge * fps * dt / 1.5, vv[1] * st.lunge * fps * dt / 1.5, 26);
      if (!this.hitDone && f >= st.hit) {
        this.hitDone = true;
        this.lastHitT = now(); this.lastHitDir = vv;
        const flip = !!st.flip !== (this.dir === 'L');
        const set = st.fx, rot = (ROT[set] || ROT.s1)[this.dir];
        g.fx.sfx(set, this.x + vv[0] * 55, this.y + vv[1] * 40 - 50, { s: st.fxs, fps: 20, rot, flip });
        if (st.ring) g.fx.sfx('ring', this.x + vv[0] * 60, this.y + vv[1] * 45, { s: 2.8, fps: 16, ground: true });
        let any = false;
        for (const e of g.enemies.list) {
          if (!e.alive) continue;
          const dx = e.x - this.x, dy = e.y - this.y, d = Math.hypot(dx, dy) || 1;
          if (d < st.r * 1.9 && (dx * vv[0] + dy * vv[1]) / d > st.arc) {
            any = this.strike(e, st.dmg, vv[0] * st.kb + dx / d * st.kb * 0.3, vv[1] * st.kb + dy / d * st.kb * 0.3, this.stage === this.combo.length - 1 ? 2 : this.stage > 0 ? 1 : 0, st.flinch) || any;
          }
        }
        if (any) { g.sound.sfx(this.stage === this.combo.length - 1 ? 'heavy' : 'hit'); g.hitstop = Math.max(g.hitstop, st.stop); g.combo(); g.recordPattern('공격', 0.05); }
        else g.sound.sfx('slash');
        if (st.shake) g.view.addShake(st.shake);
      }
      if (f >= n) {
        this.lastStage = this.stage; this.chain = 0.45;
        if (this.queued && this.stage < this.combo.length - 1) { this.stage++; this.t = 0; this.hitDone = false; this.queued = false; this.auraDone = false; this.autoFace(); }
        else { if (this.stage === this.combo.length - 1) this.chain = 0; this.state = 'idle'; }
      }
    } else if (this.state === 'dash') {
      this.t += dt; const D = 0.26, k = 1 - this.t / D;
      w.moveBody(this, this.dx * 760 * k * dt, this.dy * 760 * k * dt, 26);
      if (Math.random() < 0.8) g.fx.list.push({ ghost: true, x: this.x, y: this.y, f: 1, fl: this.lastH < 0, t: 0, n: 1, fps: 3, set: '_ghost' });
      for (const e of g.enemies.list) {
        if (!e.alive || this.dashHit.has(e)) continue;
        if (Math.hypot(e.x - this.x, e.y - this.y) < 90) {
          this.dashHit.add(e);
          if (this.strike(e, 1.3, this.dx * 380, this.dy * 380, 1, 0.12)) { g.hitstop = Math.max(g.hitstop, 0.04); g.combo(); g.sound.sfx('hit'); g.view.addShake(3); }
        }
      }
      if (this.t >= D) { this.state = 'idle'; this.running = false; }
    } else if (this.state === 'dodge') {
      const d = this.dg;
      this.t += dt; const k = Math.max(0, 1 - this.t / d.time);
      const sp = d.dist / d.time * 1.6 * k;
      w.moveBody(this, this.dx * sp * dt, this.dy * sp * dt, 26);
      g.fx.list.push({ ghost: true, x: this.x, y: this.y, f: Math.min(3, Math.floor(this.t / d.time * 4)), fl: this.lastH < 0, t: 0, n: 1, fps: 2.5, set: '_ghost' });
      if (d.dmg) for (const e of g.enemies.list) {
        if (!e.alive || this.dodgeHit.has(e)) continue;
        if (Math.hypot(e.x - this.x, e.y - this.y) < 70) { this.dodgeHit.add(e); this.strike(e, d.dmg, this.dx * 200, this.dy * 200, 1, 0.1); }
      }
      if (this.t >= d.time) this.state = 'idle';
    } else if (this.state === 'skill') {
      this.t += dt; if (this.t > 0.28) this.state = 'idle';
    } else if (this.state === 'hurt') {
      this.t += dt; const D = this.heavy ? 0.42 : 0.22;
      const k = Math.max(0, 1 - this.t / D);
      w.moveBody(this, this.dx * (this.heavy ? 320 : 180) * k * dt, this.dy * (this.heavy ? 320 : 180) * k * dt, 26);
      if (this.t > D) this.state = 'idle';
    } else if (this.state === 'dead') {
      this.t += dt;
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
    if (this.state === 'dash') { const side2 = Math.abs(this.dx) > Math.abs(this.dy); const arr = side2 ? S.atkR : this.dy > 0 ? S.atkD : S.atkU; return [arr[Math.min(arr.length - 1, this.t < 0.1 ? 2 : 3)], side2 && this.dx < 0, 0]; }
    if (this.state === 'dodge') return [S.dodge[Math.min(3, Math.floor(this.t / this.dg.time * 4))], this.lastH < 0, 0];
    if (this.state === 'skill') { const side2 = this.dir === 'L' || this.dir === 'R'; const arr = this.dir === 'D' ? S.atkD : this.dir === 'U' ? S.atkU : S.atkR; return [arr[Math.min(arr.length - 1, this.t < 0.08 ? 1 : 3)], this.dir === 'L', 0]; }
    if (this.state === 'attack') {
      const st = this.combo[this.stage], key = this.dir === 'L' ? 'R' : this.dir;
      const arr = key === 'D' ? S.atkD : key === 'U' ? S.atkU : S.atkR;
      const seq = st.seq[key];
      const i = Math.min(seq.length - 1, Math.floor(this.t * st.fps * this.aspd));
      const lift = this.stage === this.combo.length - 1 && i < 2 ? -Math.min(1, this.t * st.fps / 2) * 6 : 0;
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


  drawSwords() {}
}

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
import { charKey } from './people.js';
import { Character, drawWeapon, drawMask } from './character.js';

export class Player extends Character {
  constructor(g, x, y) {
    super('player', 'player');
    this.isPlayer = true; this.g = g; this.S = g.A.sprites.player;
    this.x = x; this.y = y;
    this.dir = 'D'; this.lastH = 1;
    this.state = 'idle'; this.t = 0; this.wf = 0;
    this.inv = 0; this.stage = 0; this.lastStage = -1; this.chain = 0; this.queued = false; this.hitDone = false;
    this.running = false; this.dust = 0; this.painT = 0; this.blink = 0;
    this.cds = { dodge: 0, s0: 0, s1: 0, s2: 0, s3: 0 }; this.cdMax = {}; this.armorT = 0;
    this.lastHitT = -9; this.lastHitDir = [0, 1];
    this.swords = [];
  }

  get s() { return this.g.state; }
  get maxHp() { return this.g.maxHp(); }
  get job() { return this.g.jobs[this.s.job] || this.g.jobs['미각성']; }
  get combo() { return this.g.gear.combo(); }
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
    const st = this.combo[0], b = this.nearest(Math.max(200, st.r * 1.9 + 30));
    if (b) this.dir = this.dirOf(b.x - this.x, b.y - this.y);
    if (this.dir === 'R') this.lastH = 1; if (this.dir === 'L') this.lastH = -1;
  }

  // 적중 판정: 회피율, 패링, 피해
  strike(e, mult, kx, ky, kind, flinch, o = {}) {
    const g = this.g, P = (k) => g.sk.P(k);
    g.combatT = 0;
    if (!o.skill && (e.st === 'atk' && !e.hitDone || (e.st === 'wind' && e.stt > e.windT - 0.12))) { g.parry(e); }
    if (!(o.noMiss || P('noMiss')) && !g.rollHit(e)) { g.fx.num(e.x, e.y - 70, 'MISS', 'miss'); g.fx.sfx('miss', e.x, e.y - 50, { s: 0.8, fps: 20 }); return false; }
    let m = mult;
    if (o.skill) m *= 1 + P('skillDmg');
    if (o.ignoreDef) m *= 1.15;
    if (o.behind) m *= 1.4 + P('back');
    const wt = g.gear.weaponType();
    let crit = 0.05 + P('crit') + (o.critBonus || 0) + g.gear.opt('crit') + (wt === 'sword' ? 0.1 : 0);
    if (!o.skill && wt === 'dagger' && (this.x - e.x) * (e.face || 1) < 0) { m *= 1.5; g.fx.num(e.x, e.y - 100, '배후', 'miss'); }
    if (e.d.boss) m *= 1 + g.gear.opt('boss');
    const wel = (g.gear.equipped('weapon') || {}).elem; if (wel === 'shadow') crit += 0.1; if (wel === 'rift') m *= 1.15;
    m *= g.buffK('atk');
    if (e.hp < e.d.hp * 0.3) { crit += P('execute'); if (o.executeB) m *= 1 + o.executeB; }
    const isCrit = Math.random() < crit;
    if (isCrit) m *= 1.5 + P('execute') * 0.75;
    const dmg = Math.max(1, Math.round(g.atkPower() * m * g.gear.dmgMult() * (0.9 + Math.random() * 0.2)));
    e.lastAlly = false;
    g.enemies.damage(e, dmg, kx, ky, isCrit ? 2 : kind, flinch);
    g.sk.onHit(e);
    // 속성 효과 (희귀 이상 무기)
    const el = (g.gear.equipped('weapon') || {}).elem;
    if (el && !o.skill && e.alive) {
      g.fx.sfx('el_' + el, e.x, e.y - 50, { s: 0.75, fps: 22 });
      if (el === 'rift') g.fx.sfx('armorbreak', e.x, e.y - 90, { s: 0.6, fps: 20 });
      if (el === 'fire') e.burnFx = true; else if (el === 'poison') e.burnFx = false;
      if (el === 'frost') { e.slowT = 1.5; if (!e.frost) g.fx.num(e.x, e.y - 100, '둔화', 'miss'); e.frost = 1.5; }
      if (el === 'fire' || el === 'poison') { e.bleed = { t: 3, dps: Math.max(1, dmg * 0.2), acc: 0 }; }
      if (el === 'magic' && g.state) g.state.mp = Math.min(g.maxMp(), (g.state.mp || 0) + 1);
      if (el === 'holy' && g.state) g.state.hp = Math.min(g.maxHp(), g.state.hp + dmg * 0.03);
      if (el === 'thunder' && Math.random() < 0.4) { const o2 = g.enemies.list.find((q) => q !== e && q.alive && Math.hypot(q.x - e.x, q.y - e.y) < 220); if (o2) { g.fx.beam(e.x, e.y - 50, Math.atan2(o2.y - e.y, o2.x - e.x), Math.hypot(o2.x - e.x, o2.y - e.y), 4, '#bfe8ff'); g.enemies.damage(o2, Math.round(dmg * 0.5), 0, 0, 0, 0.1); } }
    }
    // 무기 종류별 효과
    if (!o.skill && !o.splash) {
      if (wt === 'blade' && e.alive) { if (!e.bleed) g.fx.num(e.x, e.y - 100, '출혈', 'miss'); e.bleed = { t: 3, dps: Math.max(1, dmg * 0.25), acc: 0 }; }
      if (wt === 'gauntlet' && e.alive && Math.random() < 0.15) { e.stun = Math.max(e.stun || 0, 0.8); g.fx.num(e.x, e.y - 100, '기절', 'miss'); }
      if (wt === 'staff') for (const o2 of g.enemies.list) if (o2 !== e && o2.alive && Math.hypot(o2.x - e.x, o2.y - e.y) < 110) g.enemies.damage(o2, Math.max(1, Math.round(dmg * 0.5)), 0, 0, 0, 0.05);
    }
    const ls = g.gear.opt('lifesteal'); if (ls && g.state) g.state.hp = Math.min(g.maxHp(), g.state.hp + dmg * ls);
    if (!o.skill) g.gear.gainMastery();
    return true;
  }

  attack() {
    if (['dodge', 'hurt', 'dead', 'dash', 'skill'].includes(this.state)) return;
    if (this.state === 'walk' && this.running && !this.combo[0].ranged) {
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
    this.g.fx.sfx('dust', this.x, this.y - 10, { s: 1.0, fps: 16, ground: true });
    const jd = (this.g.skills[this.g.state && this.g.state.job] || {}).dodge; if (jd && jd.fx) this.g.fx.sfx(jd.fx, this.x, this.y - 50, { s: 1.2, fps: 16 });
    this.g.fx.num(this.x, this.y - 130, d.name, 'dodge');
  }

  skill(i = 0) { this.g.sk.cast(i); }

  hurt(v, fx, fy) {
    if (this.inv > 0 || this.state === 'dead' || this.state === 'dash' || this.state === 'dodge') return;
    const s = this.s;
    v = Math.max(1, Math.round(v * this.g.dmgTaken() * (1 + this.g.sk.P('enemyAtk'))));
    v = Math.round(this.g.sk.absorb(v));
    if (v <= 0) return;
    s.hp = Math.max(0, s.hp - v);
    this.g.combatT = 0;
    this.g.sound.sfx('hurt');
    this.g.fx.num(this.x, this.y - 140, v, 'hurt');
    if (((this.state === 'attack' && this.stage === this.combo.length - 1) || this.armorT > 0) && s.hp > 0) { this.inv = 0.4; return; }
    this.inv = 0.8;
    if (s.hp <= 0 && this.g.sk.tryRevive()) { this.inv = 2; return; }
    if (s.hp <= 0) { this.state = 'dead'; this.t = 0; this.painT = 3; this.g.onPlayerDeath(); return; }
    this.state = 'hurt'; this.t = 0; this.dx = fx; this.dy = fy; this.heavy = v >= 10;
    if (this.heavy || s.hp < this.maxHp * 0.3) this.painT = 1.3;
  }

  update(dt) {
    const g = this.g, w = g.world, s = this.s;
    w.unstick(this, 26);
    this.inv = Math.max(0, this.inv - dt); this.painT = Math.max(0, this.painT - dt); this.chain = Math.max(0, this.chain - dt);
    for (const k in this.cds) this.cds[k] = Math.max(0, this.cds[k] - dt);
    this.armorT = Math.max(0, (this.armorT || 0) - dt);
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
      const n = st.seq[key].length, fps = st.fps * this.aspd * (1 + g.gear.opt('aspd'));
      const f = Math.floor(this.t * fps);
      const vv = DV[this.dir];
      // 활·지팡이: 쏘면서 움직일 수 있다 (카이팅)
      if (st.ranged) { const v = g.input.vec(), mag = Math.hypot(v[0], v[1]); if (mag > 0.15) { const sp = 200 * g.moveMult(); w.moveBody(this, v[0] * sp * dt, v[1] * sp * dt, 26); this.wf += sp * dt; } }
      if (st.aura && !this.auraDone) { this.auraDone = true; g.fx.sfx('aura', this.x, this.y - 40, { s: 1.4, fps: 18, ground: true }); }
      if (f <= st.hit && f >= st.hit - 1) w.moveBody(this, vv[0] * st.lunge * fps * dt / 1.5, vv[1] * st.lunge * fps * dt / 1.5, 26);
      if (!this.hitDone && f >= st.hit) {
        this.hitDone = true;
        this.lastHitT = now(); this.lastHitDir = vv;
        const flip = !!st.flip !== (this.dir === 'L');
        const set = st.fx, rot = (ROT[set] || ROT.s1)[this.dir];
        const cm = this.s.job === '천마' && g.A.fx2 && g.A.fx2['cm_' + set] ? 'cm_' + set : set;
        const wset = g.A.fx2 && g.A.fx2[st.wtype + '_' + set] && !g.A.fx2[st.wtype + '_' + set][0].missing ? st.wtype + '_' + set : cm;
        if (st.ranged) {
          // 활·지팡이: 사거리 끝(또는 첫 대상)까지 화살·마력탄
          let tx = this.x + vv[0] * st.r * 1.9, ty = this.y + vv[1] * st.r * 1.9;
          const tg = this.nearest(st.r * 1.9 + 30);
          if (tg && ((tg.x - this.x) * vv[0] + (tg.y - this.y) * vv[1]) > 0) { tx = tg.x; ty = tg.y; }
          const ang = Math.atan2(ty - this.y, tx - this.x), len = Math.hypot(tx - this.x, ty - this.y);
          // 화살·마력탄이 날아가 맞으면 터진다
          const orb = st.ranged === 'orb';
          if (g.fx.frames(orb ? 'bolt' : 'arrow_fly')) g.fx.proj(orb ? 'bolt' : 'arrow_fly', this.x + vv[0] * 30, this.y - 55 + vv[1] * 20, tx, ty - 50, 1500, { s: orb ? 0.7 : 0.8, then: orb ? 'el_magic' : 'arrow_hit', thenS: 0.8 });
          else g.fx.beam(this.x + vv[0] * 30, this.y - 55 + vv[1] * 20, ang, len, orb ? 10 : 4, st.col || '#fff');
        } else {
          // 무기 종류별 평타 이펙트 (천마는 전용 이펙트 유지)
          const AT = { sword: 'atk_sword', blade: 'atk_blade', spear: 'atk_spear', dagger: 'atk_dagger', gauntlet: 'atk_punch', fist: 'atk_punch' }[st.wtype];
          const useNew = AT && g.fx.frames(AT) && !(cm.startsWith('cm_') && st.wtype === 'sword');
          const dirA = Math.atan2(vv[1], vv[0]), flipN = (this.stage % 2) === 1;
          if (useNew) g.fx.sfx(AT, this.x + vv[0] * 60, this.y + vv[1] * 40 - 55, { s: st.fxs * (st.wtype === 'spear' ? 1.2 : 0.95), fps: 26, rot: dirA, flip: false, a: 1, sy: flipN ? -1 : 1 });
          else g.fx.sfx(wset, this.x + vv[0] * 55, this.y + vv[1] * 40 - 50, { s: st.fxs, fps: 20, rot, flip });
        }
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
    const C = this.g.A.chars && this.g.A.chars[charKey(this.g, 'player')];
    if (C && C.D && C.D.length && !C.D[0].missing) {
      const pick = () => {
        const L = this.dir === 'L' ? C.R : C[this.dir] || C.D;
        let f = L[0], fl = this.dir === 'L';
        if (this.state === 'walk') f = L[Math.floor(this.wf / (this.running ? 30 : 24)) % L.length];
        else if (this.state === 'attack' || this.state === 'dash' || this.state === 'skill') f = L[Math.min(L.length - 1, this.stage % 2 ? 5 : 2)];
        else if (this.state === 'dodge') { f = C.R[Math.floor(this.t * 30) % C.R.length]; fl = this.lastH < 0; }
        return [f, fl];
      };
      for (const g2 of this.g.fx.list) if (g2.ghost) list.push({ y: this.y - 1, d: () => { const [f, fl] = pick(); v.sprite(f, g2.x, g2.y, 1.3, fl, 0.3 * (1 - g2.t / 0.4)); } });
      list.push({ y: this.y, d: () => {
        v.shadow(this.x, this.y, 30);
        const [f, fl] = pick();
        const a = this.inv > 0 && this.state !== 'dodge' && Math.floor(this.inv * 14) % 2 ? 0.4 : 1;
        if (this.state === 'dead') { const c = v.ctx; c.save(); c.translate(this.x, this.y - 20); c.rotate(-Math.PI / 2 * Math.min(1, this.t * 3)); v.sprite(f, 0, 20, 1.3, fl, a); c.restore(); }
        else this.layers(v, () => v.sprite(f, this.x, this.y, 1.3, fl, a));
      } });
      return;
    }
    for (const f of this.g.fx.list) if (f.ghost) list.push({ y: this.y - 1, d: () => v.sprite(S.dodge[f.f], f.x, f.y, CS, f.fl, 0.3 * (1 - f.t / 0.4)) });
    list.push({ y: this.y, d: () => {
      v.shadow(this.x, this.y, 30);
      const [f, fl, bob] = this.frame();
      const a = this.inv > 0 && this.state !== 'dodge' && Math.floor(this.inv * 14) % 2 ? 0.4 : 1;
      this.layers(v, () => v.sprite(f, this.x, this.y + bob, CS, fl, a));
    } });
  }


  // 장비 레이어: (위를 볼 땐 무기를 몸 뒤에) 몸 → 가면 → 무기
  layers(v, body) {
    const g = this.g, ctx = v.ctx, H = 130;
    const w = g.gear.equipped('weapon'), m = g.gear.equipped('mask');
    // 코드 모션: 무기 종류별로 몸 기울이기·내딛기·반동, 무기 궤적. 구르기는 몸을 굴린다
    this.swing = null;
    const base = { D: Math.PI / 2, U: -Math.PI / 2, R: 0, L: Math.PI }[this.dir], dv = DV[this.dir];
    let ox = 0, oy = 0, rot = 0, sq = 1;
    if (this.state === 'attack' || this.state === 'dash') {
      const st = this.combo[this.stage] || {}, k = Math.min(1, this.t * (st.fps || 16) / 3), wt = st.wtype || 'sword', pk = Math.sin(k * Math.PI);
      const side = this.stage % 2 ? 1 : -1;
      if (wt === 'spear') { this.swing = base - Math.PI / 2; ox = dv[0] * 18 * pk; oy = dv[1] * 12 * pk; }
      else if (wt === 'bow') { this.swing = base; const b = k < 0.6 ? -k / 0.6 : (k - 0.6) / 0.4 * 2 - 1; ox = dv[0] * 5 * b; oy = dv[1] * 4 * b; }
      else if (wt === 'staff') { this.swing = k < 0.45 ? base - Math.PI / 2 - 1.3 * (k / 0.45) : base - Math.PI / 2 - 1.3 + 1.3 * Math.min(1, (k - 0.45) / 0.3); ox = dv[0] * 6 * pk; oy = -6 * pk; }
      else if (wt === 'gauntlet' || wt === 'fist') { ox = dv[0] * 14 * pk; oy = dv[1] * 10 * pk; rot = (dv[0] || 0) * 0.08 * pk; }
      else { this.swing = base - Math.PI / 2 + side * (1.6 - 3.2 * k) * (wt === 'dagger' ? 0.45 : 0.6); ox = dv[0] * 9 * pk; oy = dv[1] * 6 * pk; rot = (dv[0] || side * 0.5) * 0.1 * pk; }
      if (this.state === 'dash') { ox *= 1.6; oy *= 1.6; }
    } else if (this.state === 'dodge') {
      const k = Math.min(1, this.t / ((this.dg && this.dg.time) || 0.35));
      rot = (this.dx >= 0 ? 1 : -1) * k * Math.PI * 2; sq = 0.86 + 0.14 * Math.abs(Math.cos(k * Math.PI)); oy = -10 * Math.sin(k * Math.PI);
    }
    const cx = this.x, cy = this.y - 60;
    ctx.save();
    ctx.translate(ox, oy);
    if (rot || sq !== 1) { ctx.translate(cx, cy); ctx.rotate(rot); ctx.scale(1, sq); ctx.translate(-cx, -cy); }
    if (this.state !== 'dodge') drawWeapon(g, ctx, this, w, H, true);
    body();
    drawMask(g, ctx, this, m, H);
    if (this.state !== 'dodge') drawWeapon(g, ctx, this, w, H, false);
    ctx.restore();
  }

  drawSwords() {}
}

// 몬스터: data/monsters.json 의 능력치로 움직이고 공격한다. 공통 Character 틀을 쓴다.
import { Character } from './character.js';

export class Enemies {
  constructor(g, defs, floor) {
    this.g = g; this.defs = defs; this.floor = floor; this.list = []; this.hazards = [];
    for (const sp of floor.spawns) for (let i = 0; i < sp.count; i++) this.list.push(this.make(sp.type));
  }

  scaled(type) {
    const base = this.defs[type], f = this.floor;
    return Object.assign({}, base, { hp: Math.round(base.hp * (f.hpMul || 1)), damage: Math.round(base.damage * (f.dmgMul || 1)), exp: Math.round(base.exp * (f.hpMul || 1)) });
  }

  spawnBoss(type) {
    const e = this.make(type, true);
    this.list.push(e);
    return e;
  }

  make(type, noRespawn) {
    let d = this.scaled(type);
    // 정예(금빛, 강함)·변이(보라, 빠르고 죽을 때 폭발) 변종
    if (!d.boss && !noRespawn) {
      const r = Math.random();
      if (r < 0.08) d = Object.assign({}, d, { name: '정예 ' + d.name, hp: Math.round(d.hp * 2.5), damage: Math.round(d.damage * 1.4), exp: d.exp * 3, eva: d.eva + 0.05, variant: 'elite', drop: { mana_shard: 1 }, money: d.money && [d.money[0] * 3, d.money[1] * 3] });
      else if (r < 0.13) d = Object.assign({}, d, { name: '변이 ' + d.name, hp: Math.round(d.hp * 1.6), speed: d.speed * 1.35, exp: d.exp * 2, variant: 'mutant' });
    }
    const e = Object.assign(new Character(type, 'mob'), { type, d, noRespawn: !!noRespawn, hp: d.hp, alive: true, t: Math.random() * 5, hit: 0, kx: 0, ky: 0, face: 1, cd: 0, dead: 0, bite: 0 });
    const p = this.g.player;
    const [x, y] = this.g.world.randomSpot(p, 420);
    e.x = x; e.y = y;
    return e;
  }

  damage(e, v, kx, ky, big, stun = 0.08) {
    const g = this.g;
    g.target = { e, t: 3 };
    e.hp -= v; e.hit = 0.15; e.kx += kx; e.ky += ky; e.stun = Math.max(e.stun || 0, stun);
    g.fx.sfx('imp', e.x, e.y - 28, { s: big === 2 ? 1.3 : big >= 1 ? 0.95 : 0.7, fps: 22, rot: Math.random() * 6.28 });
    g.fx.num(e.x, e.y - 70, v, big === 2 ? 'huge' : big >= 1 ? 'big' : 'normal');
    if (e.hp <= 0 && e.alive) {
      e.alive = false; e.dead = 0.6;
      g.onKill(e); if (g.sk) g.sk.onKill(e);
      if (e.d.variant === 'mutant') this.hazards.push({ x: e.x, y: e.y, r: 130, t: 0, life: 0.9, dmg: e.d.damage * 1.5, col: '#b04aff' });
    }
  }

  // 몬스터 공격: 준비(경고) → 공격(돌진) → 타격 → 회복
  update(dt) {
    const g = this.g, p = g.player, w = g.world;
    if (g.allies) g.allies.update(dt);
    if (w.reveal && p) w.reveal(p.x, p.y);
    for (const e of this.list) {
      if (!e.alive) { e.dead -= dt; if (e.dead < (w.maze ? -18 : -3.5) && !e.noRespawn) Object.assign(e, this.make(e.type)); continue; }
      // 보스방에 들어오면 보스가 깨어나고 문이 닫힌다
      if (e.dormant) { if (w.roomAt && w.roomAt(p.x, p.y) === w.boss) { e.dormant = false; w.locked = true; g.boss = e; g.hud.say(e.d.name, 2.6); g.sound.play('boss'); g.view.addShake(10); } continue; }
      e.t += dt; e.hit = Math.max(0, e.hit - dt); e.cd = Math.max(0, e.cd - dt);
      w.unstick(e, 18);
      if (e.slowT > 0) e.slowT -= dt; else e.slowK = 1;
      if (e.rootT > 0) e.rootT -= dt;
      if (e.bleed) { const b = e.bleed; b.t -= dt; b.acc += dt; if (b.acc >= 0.5) { b.acc = 0; this.damage(e, Math.max(1, Math.round(b.dps * 0.5)), 0, 0, 0, 0); } if (b.t <= 0 || !e.alive) e.bleed = null; if (!e.alive) continue; }
      const spd = e.d.speed * (e.slowK || 1);
      if (e.stun > 0) { e.stun -= dt; e.st = 'idle'; w.moveBody(e, e.kx * dt, e.ky * dt, 18); e.kx *= 0.86; e.ky *= 0.86; continue; }
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
      const alive = p.state !== 'dead';
      if (e.d.patterns && this.bossAI(e, dt, p, dx, dy, d, alive)) { w.moveBody(e, e.kx * dt, e.ky * dt, 18); e.kx *= 0.86; e.ky *= 0.86; continue; }
      const wolf = e.d.kind === 'wolf', boss = !!e.d.boss;
      const range = wolf ? 150 : 110, wind = boss ? 0.75 : wolf ? 0.5 : 0.6; e.windT = wind;
      e.st = e.st || 'idle'; e.stt = (e.stt || 0) + dt;
      if (e.st === 'idle') {
        const chase = d < (w.maze ? 640 : 520) && alive;
        // 체력이 적으면 잠깐 물러난다 (보스 제외)
        if (!boss && !e.fled && e.hp < e.d.hp * 0.25) { e.fled = true; e.fleeT = 1.6; }
        if (e.fleeT > 0) { e.fleeT -= dt; w.moveBody(e, -dx / d * spd * 1.2 * dt, -dy / d * spd * 1.2 * dt, 18); e.face = dx > 0 ? -1 : 1; continue; }
        // 한꺼번에 덤비지 않고 번갈아: 이미 둘이 공격 중이면 주위를 돈다
        const busy = !boss && this.list.filter((o) => o !== e && o.alive && (o.st === 'wind' || o.st === 'atk')).length >= 2;
        if (e.flank == null) e.flank = (Math.random() - 0.5) * 1.2;
        if (chase && busy && d < range * 2.2) {
          const s2 = e.flank >= 0 ? 1 : -1; w.moveBody(e, (-dy / d * s2 * 0.8 + (d < range * 1.5 ? -dx / d : 0)) * spd * dt, (dx / d * s2 * 0.8 + (d < range * 1.5 ? -dy / d : 0)) * spd * dt, 18);
          e.face = dx > 0 ? 1 : -1;
        } else if (chase && d > range * 0.8) {
          const hop = wolf || (e.t % 1.2) < 0.7;
          // 멀리서는 옆으로 돌아 들어온다
          const an = Math.atan2(dy, dx) + (d > 220 ? e.flank : 0);
          if (hop) w.moveBody(e, Math.cos(an) * spd * dt, Math.sin(an) * spd * dt, 18);
          e.face = dx > 0 ? 1 : -1;
        } else if (!chase) w.moveBody(e, Math.cos(e.t * 0.5) * 30 * dt, Math.sin(e.t * 0.7) * 30 * dt, 18);
        if (chase && !busy && d < range && e.cd <= 0) { e.st = 'wind'; e.stt = 0; e.ax = dx / d; e.ay = dy / d; e.face = dx > 0 ? 1 : -1; }
      } else if (e.st === 'wind') {
        // 준비 동작: 몸을 움츠리고 붉게 깜빡이며 바닥에 공격 범위 표시
        if (e.stt >= wind) { e.st = 'atk'; e.stt = 0; e.hitDone = false; g.sound.sfx('slash'); }
      } else if (e.st === 'atk') {
        const D = 0.2, sp = (wolf ? 900 : 700) * (boss ? 1.1 : 1);
        w.moveBody(e, e.ax * sp * dt, e.ay * sp * dt, 18);
        if (!e.hitDone) {
          const hx = e.x + e.ax * 20, hy = e.y + e.ay * 20;
          if (Math.hypot(p.x - hx, p.y - hy) < (boss ? 80 : 58) && alive) {
            e.hitDone = true;
            const sinceHit = performance.now() / 1000 - p.lastHitT;
            const facing = (p.lastHitDir[0] * (e.x - p.x) + p.lastHitDir[1] * (e.y - p.y)) > 0;
            if (sinceHit < 0.22 && facing) { g.parry(e); }
            else if (p.inv > 0 || p.state === 'dodge' || p.state === 'dash') { g.recordPattern('관찰', 0.3); g.fx.num(p.x, p.y - 120, '회피', 'exp'); }
            else if (Math.random() < g.playerEva()) { g.fx.num(p.x, p.y - 120, '회피', 'exp'); g.sound.sfx('dodge'); }
            else {
              p.hurt(e.d.damage, e.ax, e.ay);
              g.fx.sfx(e.d.kind === 'wolf' ? 'bite' : 'claw', p.x, p.y - 50, { s: 1.1, fps: 22 });
              g.hitstop = Math.max(g.hitstop, 0.06); g.view.addShake(boss ? 9 : 5); g.flashHurt = 0.25;
            }
          }
        }
        if (e.stt >= D) { e.st = 'rec'; e.stt = 0; }
      } else if (e.st === 'rec') {
        if (e.stt >= (boss ? 0.7 : 0.55)) { e.st = 'idle'; e.stt = 0; e.cd = (boss ? 1.1 : wolf ? 1.3 : 1.6) * (1 + 0.03 * (e.pado || 0)); }
      }
      w.moveBody(e, e.kx * dt, e.ky * dt, 18); e.kx *= 0.86; e.ky *= 0.86;
    }
    this.updateHazards(dt);
  }

  // 보스 패턴: 체력 50% 이하에서 2페이즈(격분), 패턴마다 전조가 다르다
  bossAI(e, dt, p, dx, dy, d, alive) {
    const g = this.g, w = g.world;
    e.st = e.st || 'idle'; e.stt = (e.stt || 0) + dt;
    if (!e.phase2 && e.hp < e.d.hp * 0.5) { e.phase2 = true; g.hud.say(e.d.name + '이(가) 격분했다'); g.view.addShake(10); g.flashParry = 0.15; g.sound.sfx('heavy'); }
    const k = e.phase2 ? 0.75 : 1;
    const pat = e.pat;
    if (e.st === 'idle') {
      if (d > 120 && alive) { w.moveBody(e, dx / d * e.d.speed * dt, dy / d * e.d.speed * dt, 18); e.face = dx > 0 ? 1 : -1; }
      if (e.cd <= 0 && d < 560 && alive) {
        const pool = e.d.patterns.filter((q) => !q.phase || (q.phase === 2 && e.phase2));
        let r = Math.random() * pool.reduce((a, q) => a + q.w, 0), pick = pool[0];
        for (const q of pool) { r -= q.w; if (r <= 0) { pick = q; break; } }
        if (pick.id === 'bite' && d > 160) return false;
        e.pat = pick; e.st = 'wind'; e.stt = 0; e.ax = dx / d; e.ay = dy / d; e.face = dx > 0 ? 1 : -1; e.windT = (pick.wind || 0.6) * k; e.reps = pick.id === 'charge3' ? 3 : 1;
        if (pick.id === 'bite') return false;
      }
      return !!(e.pat && e.pat.id !== 'bite') && e.st !== 'idle';
    }
    if (!pat || pat.id === 'bite') return false;
    if (e.st === 'wind') {
      if (pat.id === 'charge' || pat.id === 'charge3') { e.ax = e.ax * 0.9 + dx / d * 0.1; e.ay = e.ay * 0.9 + dy / d * 0.1; const l = Math.hypot(e.ax, e.ay) || 1; e.ax /= l; e.ay /= l; }
      if (e.stt >= e.windT) {
        e.stt = 0; e.hitDone = false; g.sound.sfx('slash');
        if (pat.id === 'stomp') { e.st = 'rec'; g.view.addShake(9); g.fx.sfx('ring', e.x, e.y, { s: pat.r / 40, fps: 14, ground: true }); if (d < pat.r && alive) this.bossHit(e, p, pat.dmg); }
        else if (pat.id === 'howl') { e.st = 'rec'; g.hud.say('울부짖음이 무리를 부른다'); for (let i = 0; i < pat.n; i++) { const m = this.make(pat.minion, true); m.x = e.x + (i ? 80 : -80); m.y = e.y + 60; w.unstick(m, 18); this.list.push(m); } }
        else e.st = 'atk';
      }
      return true;
    }
    if (e.st === 'atk') {
      const sp = pat.len / 0.4;
      w.moveBody(e, e.ax * sp * dt, e.ay * sp * dt, 18);
      if (!e.hitDone && Math.hypot(p.x - e.x, p.y - e.y) < 80 && alive) { e.hitDone = true; this.bossHit(e, p, pat.dmg); }
      if (e.stt >= 0.4) { e.reps--; if (e.reps > 0) { e.st = 'wind'; e.stt = 0; e.windT = 0.35; const l = Math.hypot(dx, dy) || 1; e.ax = dx / l; e.ay = dy / l; } else { e.st = 'rec'; e.stt = 0; } }
      return true;
    }
    if (e.st === 'rec') { if (e.stt >= 0.8 * k) { e.st = 'idle'; e.stt = 0; e.cd = 1.4 * k; e.pat = null; } return true; }
    return false;
  }

  bossHit(e, p, mult) {
    const g = this.g;
    const since = performance.now() / 1000 - p.lastHitT;
    if (since < 0.22 && (p.lastHitDir[0] * (e.x - p.x) + p.lastHitDir[1] * (e.y - p.y)) > 0) { g.parry(e); return; }
    if (p.inv > 0 || p.state === 'dodge' || p.state === 'dash') { g.fx.num(p.x, p.y - 120, '회피', 'exp'); return; }
    p.hurt(Math.round(e.d.damage * mult), e.ax || 0, e.ay || 0);
    g.fx.sfx('imp', p.x, p.y - 50, { s: 1.4, fps: 22 }); g.hitstop = Math.max(g.hitstop, 0.08); g.view.addShake(8); g.flashHurt = 0.3;
  }

  updateHazards(dt) {
    const g = this.g, p = g.player;
    for (const h of this.hazards) {
      h.t += dt;
      if (h.t >= h.life && !h.done) {
        h.done = true; g.fx.sfx('imp', h.x, h.y - 30, { s: 2, fps: 18 }); g.view.addShake(5);
        if (Math.hypot(p.x - h.x, p.y - h.y) < h.r && p.inv <= 0 && p.state !== 'dodge') p.hurt(Math.round(h.dmg), 0, 0);
      }
    }
    this.hazards = this.hazards.filter((h) => h.t < h.life + 0.1);
  }

  sheet(e) { const M = e.d.sheet && this.g.A.mobs && this.g.A.mobs[e.d.sheet]; return M && M.idle && M.idle.length && !M.idle[0].missing ? M : null; }

  sprite(e) {
    const N = this.sheet(e);
    if (N) {
      const pick = (l, fps) => l[Math.floor(e.t * fps) % l.length];
      if (e.st === 'atk') return pick(N.atk, 12);
      if (e.st === 'wind') return pick(N.wind, 8);
      if (e.hit > 0 && N.die.length) return N.die[0];
      return pick(N.move, 8);
    }
    const M = this.g.A.monsters[e.d.sprite];
    if (e.d.kind === 'wolf') return e.st === 'atk' ? M.bite[0] : e.st === 'wind' ? M.walk[0] : M.walk[Math.floor(e.t * 8) % M.walk.length];
    if (e.st === 'atk') return M.hop[1];
    if (e.st === 'wind') return M.idle[0];
    if (!e.alive) return M.splat[0];
    const ph = e.t % 1.4;
    if (ph < 0.7) return M.hop[ph < 0.35 ? 0 : 1];
    return M.idle[Math.floor(e.t * 3) % M.idle.length];
  }

  drawWarn(e) {
    const ctx0 = this.g.view.ctx;
    if (e.pat && e.pat.id === 'stomp') {
      const k = Math.min(1, e.stt / e.windT);
      ctx0.save(); ctx0.fillStyle = 'rgba(220,40,40,0.18)'; ctx0.beginPath(); ctx0.ellipse(e.x, e.y, e.pat.r, e.pat.r * 0.55, 0, 0, Math.PI * 2); ctx0.fill();
      ctx0.fillStyle = 'rgba(255,60,40,0.35)'; ctx0.beginPath(); ctx0.ellipse(e.x, e.y, e.pat.r * k, e.pat.r * 0.55 * k, 0, 0, Math.PI * 2); ctx0.fill(); ctx0.restore();
      return;
    }
    if (e.pat && e.pat.id === 'howl') return;
    const ctx = this.g.view.ctx, k = Math.min(1, e.stt / (e.d.boss ? 0.75 : e.d.kind === 'wolf' ? 0.5 : 0.6));
    const len = e.pat && e.pat.len ? e.pat.len : (e.d.kind === 'wolf' ? 190 : 150) * (e.d.boss ? 1.3 : 1), wd = e.d.boss ? 90 : 60;
    ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(Math.atan2(e.ay, e.ax));
    ctx.fillStyle = 'rgba(220,40,40,0.18)'; ctx.fillRect(0, -wd / 2, len, wd);
    ctx.fillStyle = 'rgba(255,60,40,0.42)'; ctx.fillRect(0, -wd / 2, len * k, wd);
    ctx.strokeStyle = 'rgba(255,90,70,0.8)'; ctx.lineWidth = 2; ctx.strokeRect(0, -wd / 2, len, wd);
    ctx.restore();
    ctx.fillStyle = '#ff4a3a'; ctx.font = '900 26px system-ui'; ctx.textAlign = 'center'; ctx.fillText('!', e.x, e.y - 100 * e.d.scale / 0.5); ctx.textAlign = 'left';
  }

  collect(list) {
    if (this.g.allies) for (const a of this.g.allies.list) list.push({ y: a.y, d: () => this.g.allies.draw(a) });
    for (const d of this.g.drops || []) list.push({ y: d.y, d: () => this.g.drawDrop(d) });
    const v = this.g.view, ctx = v.ctx;
    for (const h of this.hazards) list.push({ y: h.y - 300, d: () => {
      const k = Math.min(1, h.t / h.life); ctx.save(); ctx.fillStyle = 'rgba(176,74,255,0.2)'; ctx.beginPath(); ctx.ellipse(h.x, h.y, h.r, h.r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(176,74,255,0.4)'; ctx.beginPath(); ctx.ellipse(h.x, h.y, h.r * k, h.r * 0.55 * k, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); } });
    for (const e of this.list) {
      if (!v.visible(e.x, e.y)) continue;
      if (!e.alive && e.dead <= 0) continue;
      if (e.alive && e.st === 'wind') list.push({ y: e.y - 200, d: () => this.drawWarn(e) });
      list.push({ y: e.y, d: () => {
        const NS = this.sheet(e);
        let s = NS ? 1.3 * (e.d.size || 1) : e.d.scale;
        let sx = 1, sy = 1;
        if (e.st === 'wind') { const k = Math.min(1, e.stt / 0.5); sx = 1 + 0.18 * k; sy = 1 - 0.16 * k; }
        if (e.st === 'atk') { sx = 0.86; sy = 1.14; }
        if (e.alive) v.shadow(e.x, e.y, (e.d.kind === 'wolf' ? 34 : 24) * (e.d.scale / (e.d.kind === 'wolf' ? 0.55 : 0.46)));
        const f = this.sprite(e);
        const a = e.alive ? 1 : Math.max(0, e.dead / 0.6);
        const flip = NS ? e.face < 0 : e.d.kind === 'wolf' && e.face < 0;
        ctx.save(); ctx.translate(e.x, e.y); ctx.scale(sx, sy); ctx.translate(-e.x, -e.y);
        if (e.d.tint && !e.hit) ctx.filter = e.d.tint;
        if (e.hit > 0) { ctx.filter = 'brightness(3)'; v.sprite(f, e.x, e.y, s, flip, a); }
        else if (e.d.variant === 'elite') { ctx.filter = 'sepia(0.7) saturate(3) brightness(1.15)'; v.sprite(f, e.x, e.y, s * 1.15, flip, a); }
        else if (e.d.variant === 'rift') { ctx.filter = 'brightness(0.35) sepia(1) saturate(4) hue-rotate(-30deg)'; v.sprite(f, e.x, e.y, s, flip, a); }
        else if (e.d.variant === 'mutant') { ctx.filter = 'hue-rotate(220deg) saturate(2.2)'; v.sprite(f, e.x, e.y, s, flip, a); }
        else if (e.st === 'wind' && Math.floor(e.stt * 14) % 2 === 0) { ctx.filter = 'sepia(1) saturate(6) hue-rotate(-40deg) brightness(1.1)'; v.sprite(f, e.x, e.y, s, flip, a); }
        else v.sprite(f, e.x, e.y, s, flip, a);
        ctx.restore();
        if (e.bleed) { ctx.font = '700 18px system-ui'; ctx.textAlign = 'center'; ctx.fillText('🩸', e.x + 30, e.y - 80 * e.d.scale / 0.5); ctx.textAlign = 'left'; }
        if (e.stun > 0.25) { ctx.fillStyle = '#ffe9a8'; ctx.font = '700 18px system-ui'; ctx.textAlign = 'center'; ctx.fillText('✦ ✦', e.x, e.y - 90 * e.d.scale / 0.5); ctx.textAlign = 'left'; }
        if (e.alive && e.hp < e.d.hp) {
          const top = e.y - (e.d.kind === 'wolf' ? 84 : 66) * (e.d.scale / (e.d.kind === 'wolf' ? 0.55 : 0.46));
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(e.x - 24, top, 48, 6);
          ctx.fillStyle = '#e8433f'; ctx.fillRect(e.x - 23, top + 1, 46 * e.hp / e.d.hp, 4);
        }
      } });
    }
  }
}

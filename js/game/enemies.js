// 몬스터: data/monsters.json 의 능력치로 움직이고 공격한다.

export class Enemies {
  constructor(g, defs, floor) {
    this.g = g; this.defs = defs; this.floor = floor; this.list = [];
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
    const d = this.scaled(type);
    const e = { type, d, noRespawn: !!noRespawn, hp: d.hp, alive: true, t: Math.random() * 5, hit: 0, kx: 0, ky: 0, face: 1, cd: 0, dead: 0, bite: 0 };
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
      g.onKill(e);
    }
  }

  // 몬스터 공격: 준비(경고) → 공격(돌진) → 타격 → 회복
  update(dt) {
    const g = this.g, p = g.player, w = g.world;
    for (const e of this.list) {
      if (!e.alive) { e.dead -= dt; if (e.dead < -3.5 && !e.noRespawn) Object.assign(e, this.make(e.type)); continue; }
      e.t += dt; e.hit = Math.max(0, e.hit - dt); e.cd = Math.max(0, e.cd - dt);
      w.unstick(e, 18);
      if (e.stun > 0) { e.stun -= dt; e.st = 'idle'; w.moveBody(e, e.kx * dt, e.ky * dt, 18); e.kx *= 0.86; e.ky *= 0.86; continue; }
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
      const alive = p.state !== 'dead';
      const wolf = e.d.kind === 'wolf', boss = !!e.d.boss;
      const range = wolf ? 150 : 110, wind = boss ? 0.75 : wolf ? 0.5 : 0.6; e.windT = wind;
      e.st = e.st || 'idle'; e.stt = (e.stt || 0) + dt;
      if (e.st === 'idle') {
        const chase = d < 520 && alive;
        if (chase && d > range * 0.8) {
          const hop = wolf || (e.t % 1.2) < 0.7;
          if (hop) w.moveBody(e, dx / d * e.d.speed * dt, dy / d * e.d.speed * dt, 18);
          e.face = dx > 0 ? 1 : -1;
        } else if (!chase) w.moveBody(e, Math.cos(e.t * 0.5) * 30 * dt, Math.sin(e.t * 0.7) * 30 * dt, 18);
        if (chase && d < range && e.cd <= 0) { e.st = 'wind'; e.stt = 0; e.ax = dx / d; e.ay = dy / d; e.face = dx > 0 ? 1 : -1; }
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
              g.fx.sfx('imp', p.x, p.y - 50, { s: 1.1, fps: 22, rot: Math.random() * 6 });
              g.hitstop = Math.max(g.hitstop, 0.06); g.view.addShake(boss ? 9 : 5); g.flashHurt = 0.25;
            }
          }
        }
        if (e.stt >= D) { e.st = 'rec'; e.stt = 0; }
      } else if (e.st === 'rec') {
        if (e.stt >= (boss ? 0.7 : 0.55)) { e.st = 'idle'; e.stt = 0; e.cd = boss ? 1.1 : wolf ? 1.3 : 1.6; }
      }
      w.moveBody(e, e.kx * dt, e.ky * dt, 18); e.kx *= 0.86; e.ky *= 0.86;
    }
  }

  sprite(e) {
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
    const ctx = this.g.view.ctx, k = Math.min(1, e.stt / (e.d.boss ? 0.75 : e.d.kind === 'wolf' ? 0.5 : 0.6));
    const len = (e.d.kind === 'wolf' ? 190 : 150) * (e.d.boss ? 1.3 : 1), wd = e.d.boss ? 90 : 60;
    ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(Math.atan2(e.ay, e.ax));
    ctx.fillStyle = 'rgba(220,40,40,0.18)'; ctx.fillRect(0, -wd / 2, len, wd);
    ctx.fillStyle = 'rgba(255,60,40,0.42)'; ctx.fillRect(0, -wd / 2, len * k, wd);
    ctx.strokeStyle = 'rgba(255,90,70,0.8)'; ctx.lineWidth = 2; ctx.strokeRect(0, -wd / 2, len, wd);
    ctx.restore();
    ctx.fillStyle = '#ff4a3a'; ctx.font = '900 26px system-ui'; ctx.textAlign = 'center'; ctx.fillText('!', e.x, e.y - 100 * e.d.scale / 0.5); ctx.textAlign = 'left';
  }

  collect(list) {
    const v = this.g.view, ctx = v.ctx;
    for (const e of this.list) {
      if (!v.visible(e.x, e.y)) continue;
      if (!e.alive && e.dead <= 0) continue;
      if (e.alive && e.st === 'wind') list.push({ y: e.y - 200, d: () => this.drawWarn(e) });
      list.push({ y: e.y, d: () => {
        let s = e.d.scale;
        let sx = 1, sy = 1;
        if (e.st === 'wind') { const k = Math.min(1, e.stt / 0.5); sx = 1 + 0.18 * k; sy = 1 - 0.16 * k; }
        if (e.st === 'atk') { sx = 0.86; sy = 1.14; }
        if (e.alive) v.shadow(e.x, e.y, (e.d.kind === 'wolf' ? 34 : 24) * (e.d.scale / (e.d.kind === 'wolf' ? 0.55 : 0.46)));
        const f = this.sprite(e);
        const a = e.alive ? 1 : Math.max(0, e.dead / 0.6);
        const flip = e.d.kind === 'wolf' && e.face < 0;
        ctx.save(); ctx.translate(e.x, e.y); ctx.scale(sx, sy); ctx.translate(-e.x, -e.y);
        if (e.hit > 0) { ctx.filter = 'brightness(3)'; v.sprite(f, e.x, e.y, s, flip, a); }
        else if (e.st === 'wind' && Math.floor(e.stt * 14) % 2 === 0) { ctx.filter = 'sepia(1) saturate(6) hue-rotate(-40deg) brightness(1.1)'; v.sprite(f, e.x, e.y, s, flip, a); }
        else v.sprite(f, e.x, e.y, s, flip, a);
        ctx.restore();
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

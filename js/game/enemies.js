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

  damage(e, v, kx, ky, big) {
    const g = this.g;
    e.hp -= v; e.hit = 0.15; e.kx += kx; e.ky += ky; e.stun = Math.max(e.stun || 0, big === 2 ? 0.9 : big === 1 ? 0.4 : big === 3 ? 0.6 : 0.22);
    g.fx.sfx('imp', e.x, e.y - 28, { s: big === 2 ? 1.3 : big >= 1 ? 0.95 : 0.7, fps: 22, rot: Math.random() * 6.28 });
    g.fx.num(e.x, e.y - 70, v, big === 2 ? 'huge' : big >= 1 ? 'big' : 'normal');
    if (e.hp <= 0 && e.alive) {
      e.alive = false; e.dead = 0.6;
      g.onKill(e);
    }
  }

  update(dt) {
    const g = this.g, p = g.player, w = g.world;
    for (const e of this.list) {
      if (!e.alive) { e.dead -= dt; if (e.dead < -3.5 && !e.noRespawn) Object.assign(e, this.make(e.type)); continue; }
      e.t += dt; e.hit = Math.max(0, e.hit - dt); e.cd = Math.max(0, e.cd - dt); e.bite = Math.max(0, e.bite - dt);
      if (e.stun > 0) { e.stun -= dt; w.moveBody(e, e.kx * dt, e.ky * dt, 18); e.kx *= 0.86; e.ky *= 0.86; continue; }
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
      const alive = p.state !== 'dead';
      if (e.d.kind === 'wolf') {
        const chase = d < 520 && alive;
        const sp = chase ? e.d.speed : 40;
        if (d > 60) {
          const wx = chase ? dx / d : Math.cos(e.t * 0.5), wy = chase ? dy / d : Math.sin(e.t * 0.7);
          w.moveBody(e, wx * sp * dt, wy * sp * dt, 22);
          if (Math.abs(wx) > 0.1) e.face = wx > 0 ? 1 : -1;
        } else if (e.cd <= 0 && alive) { e.cd = 1.2; e.bite = 0.35; p.hurt(e.d.damage, dx / d, dy / d); }
      } else {
        const hopping = (e.t % 1.4) < 0.7;
        if (hopping && d < 460 && alive) w.moveBody(e, dx / d * e.d.speed * dt, dy / d * e.d.speed * dt, 18);
        if (d < 46 && alive) p.hurt(e.d.damage, dx / d, dy / d);
      }
      w.moveBody(e, e.kx * dt, e.ky * dt, 18); e.kx *= 0.86; e.ky *= 0.86;
    }
  }

  sprite(e) {
    const M = this.g.A.monsters[e.d.sprite];
    if (e.d.kind === 'wolf') return e.bite ? M.bite[0] : M.walk[Math.floor(e.t * 8) % M.walk.length];
    if (!e.alive) return M.splat[0];
    const ph = e.t % 1.4;
    if (ph < 0.7) return M.hop[ph < 0.35 ? 0 : 1];
    return M.idle[Math.floor(e.t * 3) % M.idle.length];
  }

  collect(list) {
    const v = this.g.view, ctx = v.ctx;
    for (const e of this.list) {
      if (!v.visible(e.x, e.y)) continue;
      if (!e.alive && e.dead <= 0) continue;
      list.push({ y: e.y, d: () => {
        const s = e.d.scale;
        if (e.alive) v.shadow(e.x, e.y, (e.d.kind === 'wolf' ? 34 : 24) * (e.d.scale / (e.d.kind === 'wolf' ? 0.55 : 0.46)));
        const f = this.sprite(e);
        const a = e.alive ? 1 : Math.max(0, e.dead / 0.6);
        const flip = e.d.kind === 'wolf' && e.face < 0;
        if (e.hit > 0) { ctx.save(); ctx.filter = 'brightness(3)'; v.sprite(f, e.x, e.y, s, flip, a); ctx.restore(); }
        else v.sprite(f, e.x, e.y, s, flip, a);
        if (e.alive && e.hp < e.d.hp) {
          const top = e.y - (e.d.kind === 'wolf' ? 84 : 66) * (e.d.scale / (e.d.kind === 'wolf' ? 0.55 : 0.46));
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(e.x - 24, top, 48, 6);
          ctx.fillStyle = '#e8433f'; ctx.fillRect(e.x - 23, top + 1, 46 * e.hp / e.d.hp, 4);
        }
      } });
    }
  }
}

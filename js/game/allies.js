// 탑 안에서 마주치는 다른 헌터 파티 (NPC). 직업 데이터대로 싸우고, 방을 오가며 몬스터를 잡는다.
// 처치 보상은 주인공 몫이 아니다 (마지막 일격이 NPC면 경험치·돈 없음).
import { framesFor, drawPerson } from './people.js';
import { drawWeapon } from './character.js';

export class Allies {
  constructor(g, world) {
    this.g = g; this.list = []; this.met = false;
    if (!world.maze || Math.random() > 0.5) return;
    const pool = world.rooms.filter((q) => q !== world.start && q !== world.boss);
    const q = pool[Math.floor(Math.random() * pool.length)], folk = g.ow.folk;
    const basic = Object.keys(g.jobs).filter((k) => g.jobs[k].basic);
    for (let i = 0; i < 3; i++) {
      const f = folk.makeFolk('tower'); const job = basic[Math.floor(Math.random() * basic.length)], J = g.jobs[job];
      f.look.outfit = 'hunter';
      const a = { id: f.uid, name: f.name, job, look: f.look, fr: framesFor(g, f.uid, f.look), x: (q.cx + 0.5 + (i - 1)) * world.TW, y: (q.cy + 0.5) * world.TH, dir: 'D', t: 0, moving: false, cd: Math.random(), reach: world.TW * J.reach, dmg: 10 + g.floor.n * 2, equip: { weapon: Object.assign({ id: J.item }, g.items[J.item]) }, home: q };
      this.list.push(a);
    }
  }

  update(dt) {
    const g = this.g, w = g.world, p = g.player; if (!this.list.length || !p) return;
    for (const a of this.list) {
      a.cd -= dt; a.t += dt;
      if (!this.met && Math.hypot(a.x - p.x, a.y - p.y) < 700) { this.met = true; g.hud.say('다른 헌터 파티가 싸우고 있다', 2.6); }
      let best = null, bd = 520;
      for (const e of g.enemies.list) if (e.alive && !e.dormant) { const d = Math.hypot(e.x - a.x, e.y - a.y); if (d < bd) { bd = d; best = e; } }
      if (best) {
        const dx = best.x - a.x, dy = best.y - a.y, d = Math.hypot(dx, dy) || 1;
        a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : dy > 0 ? 'D' : 'U';
        if (d > a.reach * 0.85) { w.moveBody(a, dx / d * 230 * dt, dy / d * 230 * dt, 22); a.moving = true; }
        else {
          a.moving = false;
          if (a.cd <= 0) {
            a.cd = 1.1; best.lastAlly = true;
            { const t = a.equip.weapon.type, ang = Math.atan2(dy, dx); if (t === 'bow' || t === 'staff') g.fx.proj(t === 'bow' ? 'arrow_fly' : 'bolt', a.x, a.y - 60, best.x, best.y - 50, 1300, { s: 0.7 }); else g.fx.sfx({ sword: 'atk_sword', blade: 'atk_blade', spear: 'atk_spear', dagger: 'atk_dagger' }[t] || 'atk_punch', a.x + Math.cos(ang) * 55, a.y - 55 + Math.sin(ang) * 30, { s: 0.8, fps: 24, rot: ang }); }
            g.enemies.damage(best, Math.round(a.dmg * (0.85 + Math.random() * 0.3)), dx / d * 120, dy / d * 120, 0, 0.05);
          }
        }
      } else {
        const hx = (a.home.cx + 0.5) * w.TW, hy = (a.home.cy + 0.5) * w.TH, d = Math.hypot(hx - a.x, hy - a.y);
        if (d > 160) { w.moveBody(a, (hx - a.x) / d * 160 * dt, (hy - a.y) / d * 160 * dt, 22); a.moving = true; } else a.moving = false;
      }
    }
  }

  draw(a) {
    const v = this.g.view, ctx = v.ctx;
    drawWeapon(this.g, ctx, a, a.equip.weapon, 130, true);
    drawPerson(v, a, 130, 1, 4.8);
    drawWeapon(this.g, ctx, a, a.equip.weapon, 130, false);
    ctx.font = '700 18px system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#000'; const t = `${a.name} · ${a.job}`;
    ctx.strokeText(t, a.x, a.y - 150); ctx.fillStyle = '#bfe8ff'; ctx.fillText(t, a.x, a.y - 150); ctx.textAlign = 'left';
  }
}

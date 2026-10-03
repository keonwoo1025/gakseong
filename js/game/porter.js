// 짐꾼 원정: 들꽃 파티가 알아서 싸우고, 나는 따라다니며 마정석을 줍고, 다친 동료를 돕고, 공격을 피한다.
// 직접 공격은 할 수 없다. 행동이 그대로 행동 패턴으로 기록된다.
import { World } from './world.js';
import { makePerson } from './pixel.js';

const PS = 4.2;
const PARTY = [
  { id: 'taesung', role: 'tank', atk: 9, range: 70, max: 160 },
  { id: 'yuna', role: 'heal', atk: 4, range: 70, max: 90 },
  { id: 'hyun', role: 'bow', atk: 8, range: 260, max: 100 },
  { id: 'eunji', role: 'mage', atk: 11, range: 240, max: 90 },
];

export class PorterRun {
  constructor(g, floor, onGoal) {
    this.g = g; this.floor = floor; this.onGoal = onGoal;
    const map = Object.assign({}, g.mapTemplate, { seed: floor.seed });
    this.world = new World(g.A, map);
    const sx = this.world.spawn.x, sy = this.world.spawn.y;
    this.me = { x: sx, y: sy + 120, dir: 'U', t: 0, moving: false, frames: makePerson(g.playerLook()), dash: 0, inv: 0, knock: null };
    this.party = PARTY.map((p, i) => ({ ...p, look: g.lookOf(p.id), frames: makePerson(g.lookOf(p.id)), x: sx - 90 + i * 60, y: sy, dir: 'U', t: 0, moving: false, hp: p.max, cd: Math.random(), emote: null, help: false }));
    this.mobs = [];
    for (const sp of floor.spawns) for (let i = 0; i < sp.count; i++) this.mobs.push(this.makeMob(sp.type));
    this.drops = []; this.shots = []; this.kills = 0; this.goal = 4 + floor.n; this.done = false; this.shards = 0;
    this.prompt = null;
  }

  makeMob(type) {
    const d = this.g.monsters[type], f = this.floor;
    const [x, y] = this.world.randomSpot({ x: this.world.spawn.x, y: this.world.spawn.y }, 500);
    return { type, x, y, hp: Math.round(d.hp * f.hpMul * 0.9), max: Math.round(d.hp * f.hpMul * 0.9), dmg: Math.round(d.damage * f.dmgMul), speed: d.speed * 0.9, kind: d.kind, sprite: d.sprite, scale: d.scale, t: Math.random() * 3, cd: 0, hit: 0, alive: true, face: 1 };
  }

  near(list, x, y, max, filter) {
    let b = null, bd = max;
    for (const o of list) { if (filter && !filter(o)) continue; const d = Math.hypot(o.x - x, o.y - y); if (d < bd) { bd = d; b = o; } }
    return b;
  }

  dodge(dx, dy) {
    const l = Math.hypot(dx, dy) || 1;
    this.me.dash = 0.3; this.me.dd = [dx / l, dy / l]; this.me.inv = 0.4;
  }

  interact() {
    const it = this.prompt; if (!it) return;
    const g = this.g, s = g.state;
    if (it.kind === 'drop') {
      this.drops.splice(this.drops.indexOf(it.o), 1);
      this.shards++; g.sound.sfx('select');
      g.recordPattern('탐구', 0.3);
      const danger = this.near(this.mobs, this.me.x, this.me.y, 250, (m) => m.alive);
      if (danger) g.recordPattern('은밀', 0.1);
    } else if (it.kind === 'help') {
      const p = it.o;
      if ((s.inv.first_aid || 0) > 0) {
        s.inv.first_aid--; p.hp = Math.min(p.max, p.hp + p.max * 0.6); p.help = false;
        g.recordPattern('구조', 2); g.aff(p.id, 2);
        g.runLine({ speaker: g.npcName(p.id), portrait: p.id, text: g.pick(['고마워. 진짜로.', '…살았다.', '짐꾼이 이런 것도 챙겨 다녀?', '다음엔 내가 갚을게.']) }, () => {});
      } else g.toast('구급상자가 없다. 편의점에서 살 수 있다.');
    }
  }

  update(dt) {
    const g = this.g, me = this.me, w = this.world, s = g.state;
    // 나
    me.inv = Math.max(0, me.inv - dt);
    if (me.knock) { w.moveBody(me, me.knock[0] * dt, me.knock[1] * dt, 22); me.knock[0] *= 0.85; me.knock[1] *= 0.85; if (Math.hypot(me.knock[0], me.knock[1]) < 20) me.knock = null; }
    if (me.dash > 0) { me.dash -= dt; w.moveBody(me, me.dd[0] * 620 * dt, me.dd[1] * 620 * dt, 22); me.moving = true; me.t += dt * 2; }
    else {
      const v = g.input.vec(), mag = Math.hypot(v[0], v[1]);
      if (mag > 0.15) {
        const sp = g.input.running() ? 360 : 240 * Math.min(1, 0.45 + mag);
        w.moveBody(me, v[0] * sp * dt, v[1] * sp * dt, 22);
        me.dir = Math.abs(v[0]) > Math.abs(v[1]) * 0.9 ? (v[0] > 0 ? 'R' : 'L') : v[1] > 0 ? 'D' : 'U';
        me.moving = true; me.t += dt;
      } else me.moving = false;
    }
    // 파티
    const lead = this.party[0];
    const alive = this.mobs.filter((m) => m.alive);
    for (const p of this.party) {
      p.cd -= dt; if (p.emote) { p.emote.t -= dt; if (p.emote.t <= 0) p.emote = null; }
      if (p.hp <= 0) continue;
      let target = this.near(alive, p.x, p.y, 520);
      if (p.role === 'heal') {
        const low = this.party.filter((q) => q.hp > 0 && q.hp < q.max * 0.7).sort((a, b) => a.hp / a.max - b.hp / b.max)[0];
        if (low && p.cd <= 0) { low.hp = Math.min(low.max, low.hp + 18); p.cd = 2.2; g.fx.sfx('aura', low.x, low.y - 30, { s: 0.6, fps: 20, a: 0.5 }); }
      }
      let gx, gy;
      if (target) {
        const d = Math.hypot(target.x - p.x, target.y - p.y);
        if (d > p.range) { gx = target.x; gy = target.y; }
        else if (p.cd <= 0) {
          p.cd = p.role === 'tank' ? 0.8 : 1.1;
          target.hp -= p.atk; target.hit = 0.12;
          if (p.range > 100) this.shots.push({ x: p.x, y: p.y - 60, tx: target.x, ty: target.y - 30, t: 0, col: p.role === 'mage' ? '#b48cff' : '#f0e2a0' });
          g.fx.sfx('imp', target.x, target.y - 28, { s: 0.5, fps: 24, rot: Math.random() * 6 });
          if (target.hp <= 0 && target.alive) this.killMob(target);
        }
        p.dir = Math.abs(target.x - p.x) > Math.abs(target.y - p.y) ? (target.x > p.x ? 'R' : 'L') : target.y > p.y ? 'D' : 'U';
      } else {
        const idx = this.party.indexOf(p);
        if (p === lead) { const d = Math.hypot(me.x - p.x, me.y - p.y); if (d > 300) { gx = me.x; gy = me.y - 100; } }
        else { gx = lead.x + (idx - 1.5) * 70; gy = lead.y + 70; }
      }
      if (gx !== undefined) {
        const dx = gx - p.x, dy = gy - p.y, d = Math.hypot(dx, dy);
        if (d > 20) { w.moveBody(p, dx / d * 210 * dt, dy / d * 210 * dt, 20); p.moving = true; p.t += dt; if (!target) p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : dy > 0 ? 'D' : 'U'; }
        else p.moving = false;
      } else p.moving = false;
      if (!p.help && p.hp < p.max * 0.35) { p.help = true; p.emote = { text: '!', t: 2.5 }; }
      if (p.help) p.emote = p.emote || { text: '!', t: 1 };
    }
    // 몬스터
    for (const m of alive) {
      m.t += dt; m.hit = Math.max(0, m.hit - dt); m.cd = Math.max(0, m.cd - dt);
      const targets = this.party.filter((p) => p.hp > 0).concat([me]);
      const tg = this.near(targets, m.x, m.y, 600);
      if (!tg) continue;
      const dx = tg.x - m.x, dy = tg.y - m.y, d = Math.hypot(dx, dy) || 1;
      if (d > 50 && (m.kind === 'wolf' || (m.t % 1.4) < 0.7)) { w.moveBody(m, dx / d * m.speed * dt, dy / d * m.speed * dt, 18); m.face = dx > 0 ? 1 : -1; }
      if (d < 56 && m.cd <= 0) {
        m.cd = 1.2;
        if (tg === me) {
          if (me.inv <= 0) { s.hp = Math.max(0, s.hp - Math.round(m.dmg * 0.7)); me.knock = [dx / d * 500, dy / d * 500]; me.inv = 0.8; g.sound.sfx('hurt'); g.view.addShake(4); g.fx.num(me.x, me.y - 140, Math.round(m.dmg * 0.7), 'hurt'); if (s.hp <= 0) { this.dead = true; g.onPorterDeath(); return; } }
          else g.recordPattern('관찰', 0.4);
        } else { tg.hp = Math.max(0, tg.hp - m.dmg); }
      }
    }
    // 패턴: 싸움 근처에서의 위치
    const fight = this.near(alive, me.x, me.y, 380);
    if (fight) {
      const hurt = this.near(this.party, me.x, me.y, 130, (p) => p.help);
      if (hurt) g.recordPattern('수호', dt * 0.3);
      else if (!me.moving) g.recordPattern('관찰', dt * 0.1);
      else if (Math.hypot(fight.x - me.x, fight.y - me.y) < 150) g.recordPattern('공격', dt * 0.15);
    } else if (alive.length && !this.near(this.party, me.x, me.y, 650)) g.recordPattern('은밀', dt * 0.12);
    // 발사체
    for (const sh of this.shots) sh.t += dt;
    this.shots = this.shots.filter((sh) => sh.t < 0.2);
    // 상호작용 대상
    let best = null, bd = 110;
    for (const o of this.drops) { const d = Math.hypot(o.x - me.x, o.y - me.y); if (d < bd) { bd = d; best = { kind: 'drop', o, label: '줍기', x: o.x, y: o.y - 50 }; } }
    for (const p of this.party) if (p.help && p.hp > 0) { const d = Math.hypot(p.x - me.x, p.y - me.y); if (d < bd + 20) { bd = d; best = { kind: 'help', o: p, label: '구급상자 건네기', x: p.x, y: p.y - 140 }; } }
    this.prompt = best;
    // 목표
    if (!this.done && this.kills >= this.goal) { this.done = true; setTimeout(() => this.onGoal && this.onGoal(), 900); }
    if (this.party.every((p) => p.hp <= 0) && !this.dead) { this.dead = true; g.onPorterDeath(); }
  }

  killMob(m) {
    m.alive = false; this.kills++;
    if (Math.random() < 0.65) this.drops.push({ x: m.x + (Math.random() - 0.5) * 30, y: m.y, t: Math.random() * 3 });
    setTimeout(() => { if (!this.done) Object.assign(m, this.makeMob(m.type)); }, 3000);
  }

  drawPerson(a, scale) {
    const v = this.g.view, f = a.dir === 'L' ? a.frames.R : a.frames[a.dir];
    const step = a.moving ? [1, 0, 2, 0][Math.floor(a.t * 8) % 4] : 0;
    v.shadow(a.x, a.y, 20);
    v.sprite(f[step], a.x, a.y, scale || PS, a.dir === 'L', a.hp !== undefined && a.hp <= 0 ? 0.35 : (a.inv > 0 && Math.floor(a.inv * 14) % 2 ? 0.5 : 1));
  }

  draw() {
    const g = this.g, v = g.view, ctx = v.ctx, w = this.world;
    v.world();
    w.drawGround(v);
    const list = [];
    w.collectProps(v, list);
    for (const o of this.drops) list.push({ y: o.y, d: () => {
      const T = performance.now() / 1000 + o.t;
      ctx.fillStyle = 'rgba(120,200,255,0.35)'; ctx.beginPath(); ctx.ellipse(o.x, o.y, 22, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.translate(o.x, o.y - 18 - Math.sin(T * 3) * 4); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#7fd4ff'; ctx.fillRect(-9, -9, 18, 18); ctx.fillStyle = '#e6f8ff'; ctx.fillRect(-9, -9, 7, 7); ctx.strokeStyle = '#1a3a5a'; ctx.lineWidth = 2; ctx.strokeRect(-9, -9, 18, 18);
      ctx.restore();
    } });
    for (const m of this.mobs) if (m.alive) list.push({ y: m.y, d: () => {
      const M = g.A.monsters[m.sprite];
      const f = m.kind === 'wolf' ? M.walk[Math.floor(m.t * 8) % M.walk.length] : M.hop[Math.floor(m.t * 3) % M.hop.length];
      v.shadow(m.x, m.y, 24);
      if (m.hit > 0) { ctx.save(); ctx.filter = 'brightness(3)'; v.sprite(f, m.x, m.y, m.scale, m.kind === 'wolf' && m.face < 0); ctx.restore(); }
      else v.sprite(f, m.x, m.y, m.scale, m.kind === 'wolf' && m.face < 0);
    } });
    for (const p of this.party) list.push({ y: p.y, d: () => this.drawPerson(p) });
    list.push({ y: this.me.y, d: () => this.drawPerson(this.me) });
    list.sort((a, b) => a.y - b.y).forEach((o) => o.d());
    for (const sh of this.shots) { const k = sh.t / 0.2; ctx.strokeStyle = sh.col; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(sh.x + (sh.tx - sh.x) * Math.max(0, k - 0.4), sh.y + (sh.ty - sh.y) * Math.max(0, k - 0.4)); ctx.lineTo(sh.x + (sh.tx - sh.x) * k, sh.y + (sh.ty - sh.y) * k); ctx.stroke(); }
    g.fx.draw(false); g.fx.drawNums();
    for (const p of this.party) {
      if (p.hp <= 0) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(p.x - 26, p.y - 124, 52, 6);
      ctx.fillStyle = p.help ? '#e8433f' : '#6ad06a'; ctx.fillRect(p.x - 25, p.y - 123, 50 * p.hp / p.max, 4);
      if (p.emote) { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1a1420'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(p.x, p.y - 150, 20, 18, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#d8483f'; ctx.font = '900 22px system-ui'; ctx.textAlign = 'center'; ctx.fillText(p.emote.text, p.x, p.y - 142); ctx.textAlign = 'left'; }
    }
    if (this.prompt) {
      const p = this.prompt;
      ctx.font = '700 22px system-ui,sans-serif'; ctx.textAlign = 'center';
      const wd = ctx.measureText(p.label).width + 28;
      ctx.fillStyle = 'rgba(20,16,12,0.85)'; ctx.fillRect(p.x - wd / 2, p.y - 22, wd, 36);
      ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 2; ctx.strokeRect(p.x - wd / 2, p.y - 22, wd, 36);
      ctx.fillStyle = '#ffe9a8'; ctx.fillText(p.label, p.x, p.y + 4); ctx.textAlign = 'left';
    }
  }
}

// 마을 사람: 탑의 몬스터와 같은 공격 판정을 받는 대상 (PK 허용일 때만).
// 성격(data/personality.json)에 따라 맞으면 반격·도망·애원·신고, 보면 막아서기·구경·신고·무시.
// 이름 있는 인물은 죽지 않고 기절했다 일어난다. 일반 행인은 죽으면 사라지고, 잠시 뒤 다른 구역에 새 행인이 생긴다.
import { Settings } from '../engine/settings.js';
import { josa } from './korean.js';

const FUNCTIONAL = new Set(['job', 'leader', 'store', 'shop']);
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const RANKS = ['none', 'F', 'E', 'D', 'C', 'B', 'A', 'S'];
const BASIC = ['검사', '전사', '궁수', '마법사', '성직자', '도적'];
// 같은 날·시간대엔 같은 결과가 나오는 난수 (행인이 나왔다 사라졌다 하지 않게)
const hash01 = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; };

export class TownFolk {
  constructor(g, ow) { this.g = g; this.ow = ow; this.hazards = []; }
  get P() { return this.g.personality; }
  get F() { return this.g.folkDef; }
  get s() { return this.g.state; }

  // ---------- 공격 대상 목록 (탑의 enemies.list 와 같은 모양) ----------
  get list() {
    if (!Settings.v.pk || this.ow.cut || !this.ow.map) return [];
    const out = [];
    for (const id in this.ow.actors) { const a = this.ow.actors[id]; if (a.folk && a.alive && a.visible && !a.ko) out.push(a); }
    return out;
  }

  // NPC 한 명에게 싸움 능력치를 붙인다
  arm(a, info) {
    const rank = info.rank || 'E', R = this.F.ranks[rank] || this.F.ranks.E;
    a.folk = true; a.rank = rank; a.awake = rank !== 'none';
    a.mortal = !!info.mortal; a.pers = info.personality || '과묵한 고독자';
    a.d = { name: info.name || a.id, hp: R.hp, damage: R.dmg, eva: R.eva };
    a.hp = Math.min(a.d.hp, info.hp || a.d.hp); a.runSp = R.spd * 1.5;
    a.mood = 'calm'; a.st = 'idle'; a.stt = 0; a.cd = 0; a.windT = 0.5; a.hit = 0;
    a.home = [a.x, a.y]; a.wanderT = 1 + Math.random() * 3;
    // 직업: 싸우는 방식·기술·무기 (data/jobs.json 기본 직업)
    const J = info.job && this.g.jobs[info.job];
    a.job = J ? info.job : null; a.role = info.role || (J ? 'hunter' : 'walker');
    a.reach = this.ow.TS * (J ? J.reach : 1.05); a.ranged = J && J.reach > 1.5;
    a.skills = J ? J.skills.filter((k) => !k.minRank || RANKS.indexOf(rank) >= RANKS.indexOf(k.minRank)).map((k) => ({ ...k, t: Math.random() * k.cd })) : [];
    if (J && this.g.items[J.item]) a.equip.weapon = Object.assign({ id: J.item }, this.g.items[J.item]);
  }

  personalityOf(id) { const n = this.s.npcs && this.s.npcs[id]; return n ? n.personality : null; }
  isMortal(npc) { const d = this.g.npcById[npc.id]; return !!(d && d.fixed === '행인' && !FUNCTIONAL.has(npc.talk) && npc.talk !== 'bark'); }
  line(a, kind) { const L = (this.P[a.pers] || {}).lines || {}; const l = L[kind]; return l && l.length ? rnd(l) : null; }
  bubble(a, kind, t = 2.2) { const l = this.line(a, kind); if (l) a.say = { text: l, t }; }

  // ---------- 행인 생성 ----------
  makeFolk(map) {
    const F = this.F, s = this.s, gender = Math.random() < 0.5 ? 'm' : 'f';
    let r = Math.random() * Object.values(F.rankWeights).reduce((a, b) => a + b, 0), rank = 'F';
    for (const k in F.rankWeights) { r -= F.rankWeights[k]; if (r <= 0) { rank = k; break; } }
    let role = 'walker', r2 = Math.random() * (F.roles.walker + F.roles.hunter);
    if (r2 > F.roles.walker) role = 'hunter';
    if (role !== 'hunter' && Math.random() > F.awakenRate) rank = 'none';
    if (role === 'hunter' && rank === 'F' && Math.random() < 0.5) rank = 'E';
    const pers = rnd(Object.keys(this.P)), ax = (this.P[pers].axes || [0, 0, 0, 0, 0]).map((v) => Math.max(-100, Math.min(100, v + Math.round((Math.random() - 0.5) * 40))));
    s.folkN = (s.folkN || 0) + 1;
    return {
      uid: 'folk' + s.folkN, map, gender, rank, role, axes: ax, job: role === 'hunter' ? rnd(BASIC) : null,
      name: rnd(F.family) + rnd(gender === 'm' ? F.male : F.female),
      personality: pers,
      look: { skin: rnd(F.skin), hair: rnd(F.hair), hairStyle: rnd(gender === 'm' ? F.hairM : F.hairF), top: rnd(F.top), bottom: rnd(F.bottom), shoes: rnd(F.shoes), outfit: role === 'hunter' ? 'hunter' : rnd(gender === 'm' ? F.outfitM : F.outfits), glasses: Math.random() < F.glasses },
    };
  }

  outdoorMaps() { return (this.g.citymap.nodes || []).map((n) => n.id); }

  // 처음 들른 바깥 구역에 행인을 채운다 (한 번만). 이후로는 죽은 만큼만 다른 구역에서 새로 생긴다.
  ensureCrowd(m) {
    const s = this.s; s.folk = s.folk || []; s.folkInit = s.folkInit || {};
    if (!m.edges || s.folkInit[m.id]) return;
    s.folkInit[m.id] = true;
    const n = m.crowd != null ? m.crowd : this.F.crowd;
    for (let i = 0; i < n; i++) s.folk.push(this.makeFolk(m.id));
  }

  randomFloor(avoid) {
    const ow = this.ow, rows = ow.grid.length, cols = ow.grid[0].length;
    for (let i = 0; i < 80; i++) {
      const c = 1 + Math.floor(Math.random() * (cols - 2)), r = 1 + Math.floor(Math.random() * (rows - 2)), t = ow.grid[r][c];
      if (ow.col[r][c] > 0 || t === 'door' || t === 'exit' || t === 'gate') continue;
      const x = (c + 0.5) * ow.TS, y = (r + 0.8) * ow.TS;
      if (avoid && Math.hypot(x - avoid.x, y - avoid.y) < ow.TS * 3) continue;
      return [x, y];
    }
    return null;
  }

  // 맵을 불러올 때: 고정 NPC에 싸움 능력치, 행인 배치
  onLoad(m) {
    const ow = this.ow, g = this.g, s = this.s;
    for (const id in ow.actors) {
      const a = ow.actors[id]; if (!a.npc) continue;
      const d = g.npcById[id] || {};
      this.arm(a, { rank: d.rank, name: g.npcName(id), mortal: this.isMortal(a.npc), personality: this.personalityOf(id) || '과묵한 고독자', job: d.job, role: a.npc.role });
      if (a.npc.talk === 'bark' || a.npc.talk === 'line') a.home = [a.x, a.y];
    }
    this.makePois(m);
    this.ensureCrowd(m);
    const p = ow.actors.player;
    const time = s.time || 0;
    for (const f of s.folk || []) {
      if (f.map !== m.id) continue;
      const pr = (this.F.schedule[f.role || 'walker'] || [1, 1, 1, 1])[time];
      if (hash01(f.uid + ':' + s.day + ':' + time) > pr) continue;   // 일과: 시간대마다 나와 있는 사람이 다르다
      const at = this.randomFloor(p); if (!at) continue;
      const a = ow.makeActor(f.uid, f.look);
      a.x = at[0]; a.y = at[1]; a.dir = rnd(['D', 'L', 'R', 'U']);
      a.npc = { id: f.uid, talk: 'stranger', label: '말 걸기' };
      ow.actors[f.uid] = a;
      this.arm(a, { rank: f.rank, name: f.name, mortal: true, personality: f.personality, job: f.job, role: f.role });
      a.crowd = true;
    }
    this.dispatchGuards(m);
  }

  // ---------- 피해 ----------
  damage(e, v, kx, ky, big, stun = 0.08) {
    const g = this.g, s = this.s, ow = this.ow;
    g.target = { e, t: 3 };
    if (e.guardT > 0) v = Math.max(1, Math.round(v * (1 - e.guardK))); e.hp -= v; e.hit = 0.15; e.kx += kx; e.ky += ky; e.stun = Math.max(e.stun || 0, stun);
    g.fx.sfx('imp', e.x, e.y - 40, { s: big === 2 ? 1.3 : big >= 1 ? 0.95 : 0.7, fps: 22, rot: Math.random() * 6.28 });
    g.fx.num(e.x, e.y - 105, v, big === 2 ? 'huge' : big >= 1 ? 'big' : 'normal');
    // 악업: 실제로 사람을 해쳤을 때만
    if (!e.hurtBy) { e.hurtBy = true; s.karma = (s.karma || 0) + 1; g.recordPattern('공격', 0.2); if (!e.mortal && g.npcById[e.id]) g.aff(e.id, -15); this.witness(e); }
    if (e.hp <= 0 && e.alive) {
      if (!e.mortal) { this.knockOut(e); return; }
      e.alive = false; e.dead = 2.2; e.mood = 'dead';
      s.karma += 10; s.kills = (s.kills || 0); s.pk = (s.pk || 0) + 1;
      if (g.sk) g.sk.onKill(e);
      this.kill(e);
      return;
    }
    this.react(e);
  }

  knockOut(e) {
    e.ko = 8; e.hp = 0; e.mood = 'ko'; e.st = 'idle'; this.s.karma += 3;
    this.bubble(e, 'ko', 2);
    this.g.target = null;
  }

  kill(e) {
    const s = this.s;
    if (e.crowd) s.folk = (s.folk || []).filter((f) => f.uid !== e.id);
    else { s.deadNpc = s.deadNpc || {}; s.deadNpc[e.id] = true; }
    s.folkDue = s.folkDue || [];
    s.folkDue.push({ at: Date.now() + 30000 + Math.random() * 40000, from: this.ow.map.id });
    this.g.hud.say(josa(e.d.name, '이') + ' 숨을 거뒀다', 2.6);
  }

  // 맞았을 때 성격별 반응
  react(e) {
    if (e.mood === 'fight' || e.mood === 'ko' || e.mood === 'dead') return;
    const P = this.P[e.pers] || {}, kind = e.awake ? P.hit : P.hitWeak;
    this.setMood(e, kind || 'flee');
  }

  setMood(e, kind) {
    if (kind === 'protect') kind = e.awake ? 'fight' : 'plead';
    if (kind === 'fight' && !e.awake && e.pers !== '열혈형') kind = 'flee';
    if (kind === 'report') { this.report(e); kind = 'flee'; }
    if (kind === 'leave') kind = 'flee';
    e.mood = kind; e.moodT = kind === 'fight' ? 20 : kind === 'flee' ? 6 : 5; e.route = null;
    this.bubble(e, kind);
  }

  report(e) {
    const s = this.s; s.infamy = (s.infamy || 0) + 1;
    if (!this.reported) { this.reported = true; this.g.hud.say('누군가 협회에 신고했다', 2.6); setTimeout(() => (this.reported = false), 15000); }
  }

  // 근처에서 본 사람들
  witness(victim) {
    const R = this.ow.TS * 7;
    for (const id in this.ow.actors) {
      const a = this.ow.actors[id];
      if (!a.folk || a === victim || !a.alive || a.ko || a.mood !== 'calm') continue;
      if (Math.hypot(a.x - victim.x, a.y - victim.y) > R) continue;
      const w = (this.P[a.pers] || {}).witness || 'watch';
      this.s.infamy = (this.s.infamy || 0) + 0.3;
      if (w === 'ignore') continue;
      if (w === 'watch') { a.mood = 'watch'; a.moodT = 6; this.bubble(a, 'witness'); continue; }
      this.setMood(a, w);
      if (a.mood !== 'fight' && !a.say) this.bubble(a, 'witness');
    }
  }

  // ---------- 경비 출동: 신고가 쌓이면 바깥 구역에 들어설 때 체포하러 온다 ----------
  dispatchGuards(m) {
    const s = this.s, G = this.F.guard; if (!m.edges || (s.infamy || 0) < G.at || this.ow.cut) return;
    if (s.guardDay === s.day + ':' + (s.time || 0)) return;
    s.guardDay = s.day + ':' + (s.time || 0);
    const p = this.ow.actors.player;
    for (let i = 0; i < 2; i++) {
      const at = this.randomFloor(p) || [p.x + 300, p.y]; const id = 'guard_t' + i;
      const a = this.ow.makeActor(id, { skin: '#e8c4a4', hair: '#22202a', hairStyle: 'buzz', top: '#2a3a5a', bottom: '#1a2236', outfit: 'hunter' });
      a.x = at[0]; a.y = at[1]; a.npc = { id, talk: 'line', text: '협회 경비대다.' };
      this.ow.actors[id] = a;
      this.arm(a, { rank: i ? 'C' : 'B', name: '협회 경비대원', mortal: true, personality: '냉철한 전략가', job: i ? '검사' : '전사', role: 'guard' });
      a.crowd = true; a.temp = true; a.mood = 'arrest'; a.moodT = 60;
    }
    this.g.toast('협회 경비대가 나타났다');
  }

  arrest(a) {
    const g = this.g, s = this.s, G = this.F.guard;
    for (const id in this.ow.actors) { const b = this.ow.actors[id]; if (b.mood === 'arrest') b.mood = 'wary'; }
    g.runLine({ speaker: '협회 경비대원', text: '신고가 여러 건 들어왔습니다. 협회까지 같이 가 주셔야겠어요.', choices: [{ text: '순순히 따른다', flag: '_comply' }, { text: '저항한다' }] }, () => {
      const guards = Object.values(this.ow.actors).filter((b) => b.role === 'guard' && b.temp);
      if (s.flags._comply) {
        delete s.flags._comply;
        const fine = Math.min(Math.max(0, s.money), G.fine * Math.ceil(s.infamy));
        s.money -= fine; s.infamy = 0;
        g.runLine({ text: `조사를 받고 벌금 ${fine.toLocaleString('ko-KR')}원을 냈다. 기록이 남았다.` });
        for (const b of guards) delete this.ow.actors[b.id];
      } else { s.infamy += 1; Settings.v.pk = true; Settings.save(); g.toast('저항했다 · PK 켜짐'); for (const b of guards) { b.mood = 'fight'; b.moodT = 30; this.bubble(b, 'fight'); } }
    });
  }

  // ---------- 매 프레임 ----------
  update(dt) {
    const g = this.g, ow = this.ow, p = ow.actors.player, s = this.s;
    if (!ow.map || !p) return;
    this.due(dt);
    const pk = Settings.v.pk;
    for (const id in ow.actors) {
      const a = ow.actors[id];
      if (!a.folk) continue;
      if (a.say) { a.say.t -= dt; if (a.say.t <= 0) a.say = null; }
      a.hit = Math.max(0, (a.hit || 0) - dt);
      if (!a.alive) { a.dead -= dt; if (a.dead <= 0) delete ow.actors[id]; continue; }
      if (a.ko) { a.ko -= dt; if (a.ko <= 0) { a.ko = 0; a.hp = Math.round(a.d.hp * 0.3); a.mood = 'wary'; a.moodT = 10; this.bubble(a, 'wary', 3); } continue; }
      if (ow.cut || a.route && a.route.length && a.mood === 'calm' && !a.wandering) continue;
      if (!pk && a.mood === 'fight' && a.role !== 'guard') { a.mood = 'wary'; a.moodT = 4; }
      if (a.stun > 0) { a.stun -= dt; a.st = 'idle'; ow.move(a, a.kx * dt, a.ky * dt); a.kx *= 0.86; a.ky *= 0.86; continue; }
      ow.move(a, a.kx * dt, a.ky * dt); a.kx *= 0.86; a.ky *= 0.86;
      a.cd = Math.max(0, a.cd - dt);
      if (a.mood !== 'calm') { a.moodT -= dt; if (a.moodT <= 0 && a.mood !== 'fight') { a.mood = 'calm'; a.route = null; } }
      const dx = p.x - a.x, dy = p.y - a.y, d = Math.hypot(dx, dy) || 1;
      if (a.mood === 'arrest') { if (d < this.ow.TS * 1.4) { a.moving = false; this.arrest(a); } else this.walk(a, dx / d, dy / d, a.runSp * 0.7, dt); continue; }
      if (a.mood === 'fight') this.fight(a, dt, p, dx, dy, d);
      else if (a.mood === 'flee') this.walk(a, -dx / d, -dy / d, a.runSp, dt);
      else if (a.mood === 'watch' || a.mood === 'wary') { const keep = ow.TS * 3; if (d < keep) this.walk(a, -dx / d, -dy / d, a.runSp * 0.5, dt); else { a.moving = false; a.faceTo(p.x, p.y); } }
      else if (a.mood === 'plead') { a.moving = false; a.faceTo(p.x, p.y); }
      else this.wander(a, dt);
      if (a.mood === 'fight' && p.state === 'dead') { a.mood = 'calm'; }
      if (a.moodT < -30 && a.mood === 'fight') a.mood = 'wary';
    }
  }

  walk(a, ux, uy, sp, dt) {
    this.ow.move(a, ux * sp * dt, uy * sp * dt);
    a.dir = a.dirOf(ux, uy); a.moving = true; a.t += dt;
  }

  // 평소: 성격에 따라 자주/가끔 돌아다닌다 (행인만, 고정 NPC는 제자리)
  wander(a, dt) {
    const ow = this.ow;
    if (!a.crowd) { a.moving = false; if (a.home && Math.hypot(a.x - a.home[0], a.y - a.home[1]) > 12) this.walk(a, (a.home[0] - a.x) / Math.hypot(a.x - a.home[0], a.y - a.home[1]), (a.home[1] - a.y) / Math.hypot(a.x - a.home[0], a.y - a.home[1]), 260, dt); return; }
    if (a.chatT > 0) { a.chatT -= dt; a.moving = false; return; }
    if (a.idleT > 0) { a.idleT -= dt; a.moving = false; if (a.goalDir) a.dir = a.goalDir; return; }
    if (a.path || (a.route && a.route.length)) return;
    if (a.toGate) { a.visible = false; a.alive = false; a.dead = 0; return; }   // 탑으로 들어감
    // 목적지에 도착: 앉기·쓰기·기다리기·구경, 가끔 옆 사람과 대화
    if (a.goal) { const g0 = a.goal; a.goal = null; a.wandering = false; a.idleT = 4 + Math.random() * 6; a.goalDir = g0.dir; if (Math.random() < 0.5) this.tryChat(a); return; }
    a.wanderT -= dt; a.wandering = false;
    if (a.wanderT > 0) return;
    const P = this.P[a.pers] || {}, k = a.role === 'guard' ? 0.9 : P.wander || 0.5;
    a.wanderT = (1 - k) * 5 + 1 + Math.random() * 3;
    if (a.role === 'hunter' && this.ow.map.id === 'plaza' && Math.random() < 0.3) {   // 헌터: 광장에서 탑 입구로 들어간다
      let gc = null; this.ow.grid.forEach((row, r) => row.forEach((t, c) => { if (t === 'gate' && !gc) gc = [c, r + 1]; }));
      if (gc) { const route = ow.routeTo(a, gc); if (route) { a.route = route; a.speed = 300; a.wandering = true; a.toGate = true; return; } }
    }
    // 가까운 볼일(벤치·자판기·노점·정류장 등)이 있으면 그쪽으로
    const pois = this.pois || [];
    if (pois.length && Math.random() < 0.6) {
      const near = pois.filter((q) => !q.busy && Math.hypot((q.c + 0.5) * ow.TS - a.x, (q.r + 0.8) * ow.TS - a.y) < ow.TS * 12);
      const q = near[Math.floor(Math.random() * near.length)];
      if (q) { const route = ow.routeTo(a, [q.c, q.r]); if (route) { a.route = route; a.speed = 170 + k * 80; a.wandering = true; a.goal = q; q.busy = true; setTimeout(() => (q.busy = false), 15000); return; } }
    }
    if (Math.random() > k + 0.2) return;
    const to = this.randomFloor(); if (!to) return;
    const c = Math.floor(to[0] / ow.TS), r = Math.floor(to[1] / ow.TS);
    if (Math.hypot(to[0] - a.x, to[1] - a.y) > ow.TS * 8) return;
    const route = ow.routeTo(a, [c, r]);
    if (route) { a.route = route; a.speed = 180 + k * 90; a.wandering = true; }
  }

  // 둘이 마주 보고 잠깐 대화
  tryChat(a) {
    const b = Object.values(this.ow.actors).find((o) => o !== a && o.crowd && o.alive && o.mood === 'calm' && !(o.chatT > 0) && !(o.route && o.route.length) && Math.hypot(o.x - a.x, o.y - a.y) < this.ow.TS * 3);
    if (!b) return;
    const L = this.F.chat[Math.floor(Math.random() * this.F.chat.length)];
    a.chatT = b.chatT = 6; a.idleT = b.idleT = 0; a.faceTo(b.x, b.y); b.faceTo(a.x, a.y); a.goalDir = a.dir; b.goalDir = b.dir;
    a.say = { text: L[0], t: 2.6 }; setTimeout(() => { if (b.alive && b.mood === 'calm') b.say = { text: L[1], t: 2.6 }; }, 2400);
  }

  // 맵의 볼일 지점: 오브젝트 앞칸
  makePois(m) {
    const P = this.F.poi || {}, out = [];
    for (const o of m.props || []) {
      const kind = P[o.obj]; if (!kind) continue;
      const [x, y] = o.at, front = [[x, y + 1, 'U'], [x, y - 1, 'D']].find(([c, r]) => this.ow.col[r] && this.ow.col[r][c] === 0);
      if (front) out.push({ c: front[0], r: front[1], dir: front[2], kind });
    }
    this.pois = out;
  }

  // 반격: 몬스터처럼 준비(붉게 깜빡임) → 공격 → 회복. 직업이 있으면 사거리·기술이 다르다.
  fight(a, dt, p, dx, dy, d) {
    const g = this.g, reach = a.reach || this.ow.TS * 1.05;
    a.st = a.st || 'idle'; a.stt += dt; a.guardT = Math.max(0, (a.guardT || 0) - dt);
    for (const k of a.skills || []) k.t = Math.max(0, k.t - dt);
    if (a.st === 'idle') {
      a.faceTo(p.x, p.y);
      if (a.ranged && d < reach * 0.55) this.walk(a, -dx / d, -dy / d, a.runSp * 0.6, dt);
      else if (d > reach * 0.8) this.walk(a, dx / d, dy / d, a.runSp * 0.8, dt); else a.moving = false;
      if (this.useSkill(a, p, dx, dy, d, reach)) return;
      if (d < reach && a.cd <= 0) { a.st = 'wind'; a.stt = 0; a.ax = dx / d; a.ay = dy / d; a.moving = false; a.mult = 1; }
    } else if (a.st === 'wind') {
      if (a.stt >= a.windT) { a.st = 'atk'; a.stt = 0; a.hitDone = false; g.sound.sfx('slash'); if (a.ranged) g.fx.beam(a.x, a.y - 60, Math.atan2(p.y - a.y, p.x - a.x), d, a.job === '궁수' ? 4 : 9, a.job === '궁수' ? '#e8f4ff' : '#9fd0ff'); }
    } else if (a.st === 'atk') {
      if (!a.ranged) this.ow.move(a, a.ax * (a.dashK || 500) * dt, a.ay * (a.dashK || 500) * dt);
      if (!a.hitDone && Math.hypot(p.x - a.x, p.y - a.y) < reach * 1.1) { a.hitDone = true; this.hitPlayer(a, p, a.d.damage * (a.mult || 1)); }
      if (a.stt >= 0.2) { a.st = 'rec'; a.stt = 0; a.dashK = 0; }
    } else if (a.st === 'rec') {
      if (a.stt >= 0.5) { a.st = 'idle'; a.stt = 0; a.cd = 1.2; }
    }
  }

  hitPlayer(a, p, dmg) {
    const g = this.g;
    const since = performance.now() / 1000 - p.lastHitT, facing = (p.lastHitDir[0] * (a.x - p.x) + p.lastHitDir[1] * (a.y - p.y)) > 0;
    if (since < 0.22 && facing && !a.ranged) g.parry(a);
    else if (p.inv > 0 || p.state === 'dodge' || p.state === 'dash') g.fx.num(p.x, p.y - 120, '회피', 'exp');
    else if (Math.random() < g.playerEva()) { g.fx.num(p.x, p.y - 120, '회피', 'exp'); g.sound.sfx('dodge'); }
    else { p.hurt(Math.round(dmg), a.ax || 0, a.ay || 0); g.fx.sfx('imp', p.x, p.y - 50, { s: 1, fps: 22 }); g.hitstop = Math.max(g.hitstop, 0.05); g.view.addShake(4); g.flashHurt = 0.2; }
  }

  // 직업 기술: 준비 시간이 끝난 것 중 상황에 맞는 하나
  useSkill(a, p, dx, dy, d, reach) {
    const g = this.g;
    for (const k of a.skills || []) {
      if (k.t > 0) continue;
      const say = () => { a.say = { text: k.name, t: 1.2 }; k.t = k.cd; };
      if (k.kind === 'heal') { if (a.hp < a.d.hp * 0.6) { say(); a.hp = Math.min(a.d.hp, a.hp + a.d.hp * k.power); g.fx.num(a.x, a.y - 120, '+' + Math.round(a.d.hp * k.power), 'exp'); return true; } continue; }
      if (k.kind === 'guard' || k.kind === 'taunt') { if (a.hp < a.d.hp * 0.8) { say(); a.guardT = 4; a.guardK = k.kind === 'guard' ? k.power : 0.25; return true; } continue; }
      if (d > reach * (k.kind === 'dash' ? 2.5 : 1.2)) continue;
      say(); a.ax = dx / d; a.ay = dy / d;
      if (k.kind === 'dash') { a.st = 'atk'; a.stt = 0; a.hitDone = false; a.dashK = 1100; a.mult = k.power; return true; }
      if (k.kind === 'retreat') { this.walk(a, -dx / d, -dy / d, a.runSp * 2, 0.15); }
      const n = k.kind === 'multi' ? k.n || 3 : k.kind === 'dot' ? 3 : 1;
      for (let i = 0; i < n; i++) setTimeout(() => { if (!a.alive || a.ko || this.ow.cut) return; if (a.ranged || k.kind === 'wave') g.fx.beam(a.x, a.y - 60, Math.atan2(p.y - a.y, p.x - a.x), Math.hypot(p.x - a.x, p.y - a.y), 8, '#ffd8a0'); if (Math.hypot(p.x - a.x, p.y - a.y) < reach * 1.3) this.hitPlayer(a, p, a.d.damage * k.power); }, 260 + i * 220);
      a.st = 'rec'; a.stt = -0.3 - n * 0.2;
      return true;
    }
    return false;
  }

  // 죽은 만큼 다른 구역에 새 행인 (지금 있는 구역이 아닌 곳, 사람이 적은 곳부터)
  due() {
    const s = this.s; if (!s.folkDue || !s.folkDue.length) return;
    const now = Date.now(), cur = this.ow.map.id;
    s.folkDue = s.folkDue.filter((d) => {
      if (d.at > now) return true;
      const maps = this.outdoorMaps().filter((m) => m !== cur && m !== d.from);
      if (!maps.length) return true;
      const cnt = (m) => (s.folk || []).filter((f) => f.map === m).length;
      maps.sort((x, y) => cnt(x) - cnt(y) || Math.random() - 0.5);
      s.folk.push(this.makeFolk(maps[0]));
      return false;
    });
  }

  // 대화: 화가 나 있거나 겁먹은 상태면 반응만
  talkBlocked(a) {
    if (!a.folk) return false;
    if (a.ko || !a.alive) return true;
    if (a.mood && a.mood !== 'calm') { const k = a.mood === 'fight' ? 'fight' : a.mood === 'flee' ? 'flee' : 'wary'; this.bubble(a, k); return true; }
    return false;
  }
}

// 퀘스트: data/quests.json
// { id: { type: main|sub, title, giver(NPC id), if(받을 조건), deadline(날짜), desc,
//         stages:[{ text, target:{map,at}, goals:[{type: kill|collect|talk|go|floor, ...}] }],
//         reward:{money, exp, items:{id:n}, aff:{id:n}}, offer:[대사], accept:[대사], decline:[대사], report:[대사], take:true(수집품 회수) } }
// 머리 위 표시: 받을 수 있으면 ?, 완료 보고가 가능하면 !. 짐꾼 시절(각성 전)에는 퀘스트가 없다.
import { checkCond } from './events.js';

export class Quests {
  constructor(g) { this.g = g; }
  get D() { return this.g.questDef || {}; }
  get s() { return this.g.state; }
  q(id) { return (this.s.quests = this.s.quests || {})[id]; }
  status(id) { const q = this.q(id); return q ? q.st : 'none'; }

  start(id) {
    const d = this.D[id]; if (!d || this.q(id)) return;
    this.s.quests[id] = { st: 'active', stage: 0, prog: {} };
    if (!this.s.track || this.status(this.s.track) !== 'active') this.s.track = id;
    this.g.sysNote(`[퀘스트] ${d.title}`);
    this.sync();
  }

  // 목표 하나의 진행 (현재 값, 필요 값)
  goal(id, k) {
    const q = this.q(id), d = this.D[id], G = d.stages[q.stage].goals[k], s = this.s, n = G.n || 1;
    if (G.type === 'collect') return [Math.min(n, this.g.countItem(G.item)), n];
    if (G.type === 'floor') return [s.cleared && s.cleared[G.floor] ? 1 : 0, 1];
    return [Math.min(n, q.prog[k] || 0), n];
  }
  stageDone(id) { const q = this.q(id), st = this.D[id].stages[q.stage]; return st.goals.every((_, k) => { const [a, b] = this.goal(id, k); return a >= b; }); }
  ready(id) { const d = this.D[id]; return this.status(id) === 'active' && this.q(id).stage === d.stages.length - 1 && this.stageDone(id); }

  // 행동이 일어날 때 진행을 올린다
  on(type, info) {
    for (const id in this.s.quests || {}) {
      const q = this.q(id); if (q.st !== 'active') continue;
      const st = this.D[id].stages[q.stage];
      st.goals.forEach((G, k) => {
        if (G.type !== type) return;
        if (type === 'kill' && G.monster && G.monster !== info.monster) return;
        if (type === 'talk' && G.npc !== info.npc) return;
        if (type === 'go' && G.map !== info.map) return;
        q.prog[k] = (q.prog[k] || 0) + 1;
      });
      // 마지막 단계가 아니면 다음 단계로 (마지막은 의뢰인에게 보고)
      if (q.stage < this.D[id].stages.length - 1 && this.stageDone(id)) { q.stage++; q.prog = {}; this.g.sysNote(`[퀘스트] ${this.D[id].stages[q.stage].text}`); }
    }
    this.sync();
  }

  // 머리 위 표시
  mark(npc) {
    if (!this.g.awakened()) return null;
    for (const id in this.D) {
      const d = this.D[id]; if (d.giver !== npc) continue;
      if (this.ready(id) && !d.auto) return '!';
      if (this.status(id) === 'none' && checkCond(this.g, d.if)) return '?';
    }
    return null;
  }

  // 말 걸었을 때: 보고 → 받기 순서. 처리했으면 true
  talk(npc) {
    if (!this.g.awakened()) return false;
    const g = this.g, name = g.npcName(npc), pk = g.portraitKey(npc);
    const line = (t) => ({ speaker: name, portrait: pk, text: g.fmt(t) });
    for (const id in this.D) {
      const d = this.D[id]; if (d.giver !== npc) continue;
      if (this.ready(id)) { g.runLines((d.report || ['고마워요.']).map(line), () => this.complete(id)); return true; }
      if (this.status(id) === 'none' && checkCond(g, d.if)) {
        const offer = (d.offer || [d.desc]).map(line);
        offer[offer.length - 1].choices = [{ text: '맡겠다', flag: '_qok' }, { text: '지금은 어렵다' }];
        g.runLines(offer, () => {
          const ok = g.state.flags._qok; delete g.state.flags._qok;
          if (ok) { this.start(id); if (d.accept) g.runLines(d.accept.map(line)); }
          else if (d.decline) g.runLines(d.decline.map(line));
        });
        return true;
      }
    }
    return false;
  }

  complete(id) {
    const g = this.g, s = this.s, d = this.D[id], q = this.q(id), R = d.reward || {};
    for (const G of d.stages[q.stage].goals) if (G.type === 'collect' && d.take !== false) s.inv[G.item] = Math.max(0, (s.inv[G.item] || 0) - (G.n || 1));
    q.st = 'done';
    if (R.money) s.money += R.money;
    if (R.exp && g.awakened()) g.gainExp(R.exp);
    for (const it in R.items || {}) { if (g.gear.isGear(it)) g.gear.give(it); else s.inv[it] = (s.inv[it] || 0) + R.items[it]; }
    for (const n in R.aff || {}) g.aff(n, R.aff[n]);
    g.sound.sfx('levelup');
    g.sysNote(`[퀘스트 완료] ${d.title}`);
    if (s.track === id) s.track = Object.keys(s.quests).find((k) => s.quests[k].st === 'active') || null;
    this.sync(); g.save();
  }

  // 추적 중인 퀘스트로 목표 안내(화살표·지금 할 일)를 맞춘다
  sync() {
    const s = this.s, id = s.track; if (!id || this.status(id) !== 'active' || !this.g.awakened()) return;
    const d = this.D[id], q = this.q(id), st = d.stages[q.stage];
    const ready = this.ready(id);
    s.objective = d.title + ' · ' + (ready && d.giver ? this.g.npcName(d.giver) + '에게 보고' : st.text);
    if (ready && d.giverAt) s.objTarget = d.giverAt; else if (st.target) s.objTarget = st.target;
  }

  // 기한 지난 퀘스트 (메인 31층 기한은 이후 1부 클라이맥스 이벤트가 처리)
  checkDeadline() {
    for (const id in this.s.quests || {}) {
      const q = this.q(id), d = this.D[id];
      if (q.st === 'active' && d.deadline && this.s.day > d.deadline && d.type !== 'main') { q.st = 'failed'; this.g.sysNote(`[퀘스트 실패] ${d.title}`); }
    }
  }
}

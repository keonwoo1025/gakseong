// 이벤트 = 트리거 + 조건 + 행동.
// 행동(steps)은 컷신 실행기(overworld.js Cutscene)가 실제 캐릭터·맵·카메라·대사로 실행한다.
// 이벤트 파일: data/events/<id>.json  { id, steps:[...] }
// 트리거 목록: data/events.json (전역) + 각 맵의 events (그 맵에서만)
//   on: { type: step|talk|examine|enter|item|kill|day|flag, ... }, if: 조건, once: 기본 true, play: 이벤트 id 또는 steps 직접

// ---------- 조건 ----------
// { flag, noflag, gender, phase, notPhase, job, awakened, var:{x:[">=",3]}, day:{min,max}, karma:{min,max},
//   minKarma, maxKarma, aff:{id:최소}, minAff, item:{id:개수}, lv:{min,max}, quest:{id:상태}, personality(대화 상대),
//   all:[...], any:[...], not:{...} }
const CMP = { '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '<': (a, b) => a < b, '==': (a, b) => a === b, '!=': (a, b) => a !== b };
const range = (v, r) => (r.min === undefined || v >= r.min) && (r.max === undefined || v <= r.max);

export function checkCond(g, c, ctx = {}) {
  if (!c) return true;
  const s = g.state; if (!s) return false;
  for (const k in c) {
    const v = c[k];
    if (k === 'flag' && !s.flags[v]) return false;
    if (k === 'noflag' && s.flags[v]) return false;
    if (k === 'gender' && s.gender !== v) return false;
    if (k === 'phase' && s.phase !== v) return false;
    if (k === 'notPhase' && s.phase === v) return false;
    if (k === 'job' && s.job !== v) return false;
    if (k === 'awakened' && g.awakened() !== v) return false;
    if (k === 'var') for (const n in v) { const [op, x] = v[n]; if (!CMP[op]((s.vars || {})[n] || 0, x)) return false; }
    if (k === 'day' && !range(s.day, v)) return false;
    if (k === 'karma' && !range(s.karma || 0, v)) return false;
    if (k === 'minKarma' && (s.karma || 0) < v) return false;
    if (k === 'maxKarma' && (s.karma || 0) > v) return false;
    if ((k === 'aff' || k === 'minAff')) for (const id in v) if ((s.aff[id] || 0) < v[id]) return false;
    if (k === 'item') for (const id in v) if (g.countItem(id) < v[id]) return false;
    if (k === 'lv' && !(g.awakened() && range(s.lv, v))) return false;
    if (k === 'quest') for (const id in v) if (g.quests.status(id) !== v[id]) return false;
    if (k === 'personality') { const n = ctx.npc && s.npcs && s.npcs[ctx.npc]; if (!n || n.personality !== v) return false; }
    if (k === 'all' && !v.every((x) => checkCond(g, x, ctx))) return false;
    if (k === 'any' && !v.some((x) => checkCond(g, x, ctx))) return false;
    if (k === 'not' && checkCond(g, v, ctx)) return false;
  }
  return true;
}

// ---------- 트리거 ----------
export class Events {
  constructor(g) { this.g = g; this.pollT = 0; }
  get s() { return this.g.state; }
  list() { const m = this.g.ow.map; return (this.g.eventList || []).concat((m && m.events) || []); }
  done(e) { return e.once !== false && this.s.flags['ev_' + e.id]; }

  // 맞는 이벤트가 있으면 실행하고 true
  fire(type, info = {}) {
    const g = this.g;
    if (!this.s || g.mode !== 'world' || g.ow.cut || g.talking) return false;
    for (const e of this.list()) {
      const on = e.on || {};
      if (on.type !== type || this.done(e)) continue;
      if (on.map && (!g.ow.map || g.ow.map.id !== on.map)) continue;
      if (!this.match(on, info)) continue;
      if (!checkCond(g, e.if, info)) continue;
      if (e.once !== false) this.s.flags['ev_' + e.id] = true;
      g.ow.play(e.play || e.steps);
      return true;
    }
    return false;
  }

  match(on, i) {
    if (on.type === 'step') { const [x, y, w, h] = on.rect, c = i.c, r = i.r; return c >= x && c < x + w && r >= y && r < y + h; }
    if (on.type === 'talk') return on.npc === i.npc;
    if (on.type === 'examine') return on.obj === i.obj;
    if (on.type === 'enter') return !on.map || on.map === i.map;
    if (on.type === 'item') return on.item === i.item;
    if (on.type === 'kill') return ((this.s.vars || {})['kill_' + (on.monster || 'all')] || 0) >= (on.count || 1);
    return true;   // day, flag: 조건(if)만 본다
  }

  // 날짜·플래그 트리거는 마을에서 한가할 때 주기적으로 확인
  update(dt) {
    this.pollT -= dt; if (this.pollT > 0) return; this.pollT = 0.5;
    this.fire('day') || this.fire('flag') || this.fire('kill');
  }

  countKill(type) {
    const v = (this.s.vars = this.s.vars || {});
    v['kill_' + type] = (v['kill_' + type] || 0) + 1; v.kill_all = (v.kill_all || 0) + 1;
  }
}

import { checkCond } from './events.js';
// 대사 실행기: data/dialogue/*.json 의 줄을 순서대로 보여주고, 선택지는 행동 패턴과 친밀도에 기록한다.
// 줄 형식: { speaker, portrait, text, variants:[{if:{...}, text}], choices:[{text, pattern, aff, flag}], if:{...} }
import { fmt } from './korean.js';

export class Dialogue {
  constructor(game) {
    this.g = game;
    this.scene = null;
    this.cur = null;
    this.t = 0;
    this.rects = [];
  }

  get active() { return !!this.scene; }

  start(scene, onEnd) {
    this.scene = scene; this.i = -1; this.onEnd = onEnd;
    this.next();
  }

  // 조건은 이벤트와 같은 형식 (events.js checkCond)
  match(cond) { return checkCond(this.g, cond, { npc: cond && cond.npc }); }

  next() {
    const lines = this.scene.lines;
    this.i++;
    while (this.i < lines.length && !this.match(lines[this.i].if)) this.i++;
    if (this.i >= lines.length) {
      const cb = this.onEnd; this.scene = null; this.cur = null;
      cb && cb();
      return;
    }
    const L = lines[this.i];
    let text = L.text || '';
    if (L.variants) for (const v of L.variants) if (this.match(v.if)) { text = v.text; break; }
    const who = this.g.state;
    this.cur = {
      speaker: fmt(L.speaker || '', who),
      portrait: L.portrait || null,
      text: fmt(text, who),
      choices: L.choices ? L.choices.filter((c) => this.match(c.if)).map((c) => ({ ...c, text: fmt(c.text, who) })) : null,
    };
    if (L.set) Object.assign(this.g.state.flags, L.set);
    this.t = 0; this.rects = [];
  }

  typed() { return this.t * 32 >= this.cur.text.length; }

  tap(x, y) {
    if (!this.cur) return;
    if (!this.typed()) { this.t = 999; return; }
    if (this.cur.choices && this.cur.choices.length) {
      const hit = this.rects.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
      if (!hit) return;
      this.choose(hit.c);
      return;
    }
    this.next();
  }

  choose(c) {
    const s = this.g.state;
    if (c.pattern) s.pattern[c.pattern] = (s.pattern[c.pattern] || 0) + (c.weight || 1);
    if (c.aff) for (const id in c.aff) s.aff[id] = (s.aff[id] || 0) + c.aff[id];
    if (c.flag) s.flags[c.flag] = true;
    this.next();
  }

  update(dt) { if (this.cur) this.t += dt; }
}

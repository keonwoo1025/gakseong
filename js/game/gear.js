// 장비: 아이템 DB(data/items.json) + 규칙(data/gear.json).
// 장비는 개별 물건(강화 수치를 가짐)으로 s.gear 에 들고, s.equip[부위] 에 그 번호를 넣는다.
// 무기 종류별 콤보, 희귀도 6단계, 강화 +15(+8부터 실패 시 하락, 파괴 없음), 숙련도(쓸수록 피해 증가, 5·10단계 마무리 강화).

export class Gear {
  constructor(g) { this.g = g; }
  get D() { return this.g.gearDef; }
  get s() { return this.g.state; }
  item(uid) { const o = this.s.gear && this.s.gear[uid]; return o ? Object.assign({ uid, plus: o.plus || 0 }, this.g.items[o.id], { id: o.id }) : null; }
  give(id, plus = 0) {
    const s = this.s; s.gear = s.gear || {}; s.gearN = (s.gearN || 0) + 1;
    const uid = 'g' + s.gearN; s.gear[uid] = { id, plus }; return uid;
  }
  isGear(id) { const it = this.g.items[id]; return it && this.D.slots.some(([k]) => k === it.slot); }
  owned() { return Object.keys(this.s.gear || {}); }
  count(id) { return this.owned().filter((u) => this.s.gear[u].id === id).length; }
  // 각성 전에는 옷만
  canEquip(slot) { return this.g.awakened() || slot === 'outfit'; }
  equipped(slot) { const u = this.s.equip[slot]; if (!u) return null; if (!this.canEquip(slot)) return null; return this.item(u); }
  equip(uid) { const it = this.item(uid); if (!it || !this.canEquip(it.slot)) return false; this.s.equip[it.slot] = uid; return true; }
  unequip(slot) { delete this.s.equip[slot]; }

  // 능력치 합: 공격·체력·방어는 강화 1단계마다 +8%
  stat(k) {
    let v = 0;
    for (const [slot] of this.D.slots) {
      const it = this.equipped(slot); if (!it || !it[k]) continue;
      v += ['atk', 'hp', 'def'].includes(k) ? it[k] * (1 + this.D.enhance.perLevel * it.plus) : it[k];
    }
    return k === 'atk' || k === 'hp' || k === 'def' ? Math.round(v) : v;
  }
  weaponType() { const w = this.equipped('weapon'); return w ? w.type : 'fist'; }

  // ---------- 숙련도 ----------
  mastery(type = this.weaponType()) {
    const m = (this.s.mastery = this.s.mastery || {}), o = m[type] || (m[type] = { lv: 0, xp: 0 });
    return o;
  }
  masteryNeed(lv) { return Math.round(this.D.mastery.need * Math.pow(lv + 1, 1.5)); }
  gainMastery() {
    const type = this.weaponType(); if (type === 'fist' && !this.g.awakened()) return;
    const o = this.mastery(type), job = this.g.jobs[this.s.job] || {};
    if (o.lv >= this.D.mastery.max) return;
    o.xp += job.weapon === type ? 1.5 : 1;
    if (o.xp >= this.masteryNeed(o.lv)) { o.xp = 0; o.lv++; this.g.hud.say(`${this.D.types[type].name} 숙련도 ${o.lv}단계`); this.combos = null; }
  }
  // 피해 배율: 숙련도 + 전설직 주무기
  dmgMult() {
    const type = this.weaponType(), job = this.g.jobs[this.s.job] || {};
    return (1 + this.mastery(type).lv * this.D.mastery.dmgPer) * (job.weapon === type ? 1.15 : 1) * (1 + this.stat('atkPct'));
  }

  // ---------- 콤보 ----------
  // 직업이 단계 수(일반3·전설5)를, 무기 종류가 사거리·속도·위력을, 전설·신화 무기가 1단계를 더한다.
  combo() {
    const s = this.s, job = this.g.jobs[s.job] || this.g.jobs['미각성'];
    const type = this.weaponType(), w = this.equipped('weapon');
    const legendW = w && (w.rarity === '전설' || w.rarity === '신화');
    const ml = this.mastery(type).lv;
    const key = [job.combo || 'base3', type, legendW ? 1 : 0, ml >= 10 ? 2 : ml >= 5 ? 1 : 0].join('|');
    this.combos = this.combos || {};
    if (this.combos[key]) return this.combos[key];
    const T = this.D.types[type] || this.D.types.sword;
    let base = (this.g.combos[job.combo || 'base3'] || this.g.combos.base3).map((x) => ({ ...x }));
    if (legendW) { const l = base[base.length - 1]; base.push({ ...l, dmg: l.dmg * 1.25, r: l.r * 1.1, shake: (l.shake || 0) + 2, ring: true }); }
    const out = base.map((st, i) => ({
      ...st, r: st.r * T.r, arc: Math.min(0.95, st.arc + T.arc), dmg: st.dmg * T.dmg, fps: st.fps * T.fps,
      kb: st.kb * T.kb, lunge: st.lunge * T.lunge, fxs: st.fxs * T.fxs, wtype: type, ranged: T.ranged, col: T.col, thrust: T.thrust,
    }));
    const fin = this.D.mastery.finisher, last = out[out.length - 1];
    if (ml >= 10) { last.dmg *= fin['10']; last.ring = true; } else if (ml >= 5) last.dmg *= fin['5'];
    return (this.combos[key] = out);
  }

  // ---------- 강화 ----------
  enhanceCost(it) {
    const E = this.D.enhance, k = E.rarityCost[it.rarity] || 1;
    return { money: Math.round(E.money * Math.pow(it.plus + 1, 1.6) * k / 100) * 100, shard: Math.ceil((it.plus + 1) / 3) };
  }
  enhance(uid) {
    const it = this.item(uid), E = this.D.enhance, s = this.s;
    if (!it || it.plus >= E.max) return { ok: false, msg: '더 강화할 수 없다' };
    const c = this.enhanceCost(it);
    if (s.money < c.money || (s.inv.mana_shard || 0) < c.shard) return { ok: false, msg: '돈이나 마정석 조각이 모자라다' };
    s.money -= c.money; s.inv.mana_shard -= c.shard;
    if (Math.random() < E.rate[it.plus]) { s.gear[uid].plus++; this.combos = null; return { ok: true, msg: `강화 성공 · +${it.plus + 1}` }; }
    if (it.plus > E.safeUntil) { s.gear[uid].plus--; return { ok: false, msg: `강화 실패 · +${it.plus - 1}로 내려갔다` }; }
    return { ok: false, msg: '강화 실패 · 수치는 그대로다' };
  }

  // ---------- 드롭 ----------
  rollDrop(e) {
    const D = this.D, kind = e.d.boss ? 'boss' : e.d.variant === 'elite' ? 'elite' : 'normal';
    if (Math.random() > D.dropRate[kind]) return null;
    const R = Object.keys(D.rarity), w = D.dropWeights.slice();
    if (kind !== 'normal') { w[0] *= 0.3; w[1] *= 0.7; }
    let r = Math.random() * w.reduce((a, b) => a + b, 0), ri = 0;
    for (; ri < w.length - 1; ri++) { r -= w[ri]; if (r <= 0) break; }
    const pool = Object.keys(this.g.items).filter((id) => this.isGear(id) && this.g.items[id].rarity === R[ri] && id !== 'dagger_old' && id !== 'cloth_work');
    if (!pool.length) return null;
    const id = pool[Math.floor(Math.random() * pool.length)];
    this.give(id);
    return id;
  }

  color(r) { return this.D.rarity[r] || '#ccc'; }
}

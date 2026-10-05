// 저장: 브라우저 저장소에 한 칸. 하드코어라 죽으면 지워진다.

const KEY = 'gakseong_save_v4';   // 장비·마을 구조 개편으로 이전 기록은 이어지지 않는다

export const Save = {
  has() { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } },
  load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } },
  write(state) { try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch (e) { return false; } },
  wipe() { try { localStorage.removeItem(KEY); } catch (e) {} },
};

export function newState(family, given, gender) {
  return {
    v: 2,
    family, given, gender,
    job: '미각성',
    phase: 'porter',
    money: 30000,
    inv: { first_aid: 1, ramen: 2, painkiller: 1, mana_shard: 0 },
    gear: {}, gearN: 0, mastery: {},
    porterDepth: 0,
    objective: '',
    map: 'room',
    equip: {},
    unlocked: 1,
    cleared: {},
    rumor: 0,
    talked: {},
    lv: 1, exp: 0, pts: 0,
    stats: { str: 5, dex: 5, int: 5, vit: 5 },
    mp: 40,
    hp: 0, sp: 60,
    day: 0, dayT: 0,
    pattern: { 공격: 0, 수호: 0, 관찰: 0, 탐구: 0, 구조: 0, 은밀: 0 },
    karma: 0, infamy: 0, pk: 0,
    folk: [], folkInit: {}, folkDue: [], deadNpc: {},
    time: 0, gifted: {}, vars: {},
    flags: {},
    aff: {},
    kills: 0,
    scene: 'prologue_intro',
    pos: null,
  };
}

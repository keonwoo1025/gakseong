// 저장: 브라우저 저장소에 한 칸. 하드코어라 죽으면 지워진다.

const KEY = 'gakseong_save_v3';

export const Save = {
  has() { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } },
  load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } },
  write(state) { try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch (e) { return false; } },
  wipe() { try { localStorage.removeItem(KEY); } catch (e) {} },
};

export function newState(family, given, gender) {
  return {
    v: 1,
    family, given, gender,
    job: '미각성',
    phase: 'porter',
    money: 30000,
    inv: { first_aid: 1, ramen: 2, painkiller: 1, mana_shard: 0, dagger_old: 1, cloth_work: 1 },
    porterDepth: 0,
    objective: '',
    map: 'room',
    equip: { weapon: 'dagger_old', outfit: 'cloth_work' },
    unlocked: 1,
    cleared: {},
    rumor: 0,
    talked: {},
    lv: 1, exp: 0, pts: 0,
    stats: { str: 5, agi: 5, int: 5, spi: 5, vit: 5 },
    hp: 0, sp: 60,
    day: 0, dayT: 0,
    pattern: { 공격: 0, 수호: 0, 관찰: 0, 탐구: 0, 구조: 0, 은밀: 0 },
    karma: 0,
    flags: {},
    aff: {},
    kills: 0,
    scene: 'prologue_intro',
    pos: null,
  };
}

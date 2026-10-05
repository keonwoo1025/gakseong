// 공통 캐릭터: 주인공, 마을 NPC, 몬스터가 같은 틀(위치·방향·이동·충돌·체력·상태·장비·레이어 그리기)을 쓴다.
// 주인공만 성장·인벤토리·스킬이 더해진다 (player.js).
// 그리기 순서: 그림자 → 몸 → 옷 → 머리·얼굴 → 가면 → 무기 → 장신구 → 이펙트.
// 옷·무기·가면 그림은 이름 기반 자리: 아틀라스에 같은 이름이 들어오면 그 그림을 쓰고, 없으면 코드 그림으로 대신한다.

export const DV = { D: [0, 1], U: [0, -1], R: [1, 0], L: [-1, 0] };

export class Character {
  constructor(id, kind = 'npc') {
    this.id = id; this.kind = kind;
    this.x = 0; this.y = 0; this.dir = 'D'; this.t = 0;
    this.moving = false; this.visible = true; this.speed = 390;
    this.alive = true; this.kx = 0; this.ky = 0; this.stun = 0;
    this.equip = {};          // 부위별 장비 (NPC는 자리만, 이후 직업 틀에서 채움)
    this.emote = null; this.say = null;
  }

  dirOf(x, y) { if (Math.abs(x) > Math.abs(y) * 0.9) return x > 0 ? 'R' : 'L'; return y > 0 ? 'D' : 'U'; }
  faceTo(x, y) { this.dir = this.dirOf(x - this.x, y - this.y); }
  dist(o) { return Math.hypot(o.x - this.x, o.y - this.y); }
}

// ---------- 장비 레이어 ----------
// h: 화면 키(월드 px). 손 위치는 방향별 비율.
const HAND = { D: [0.2, 0.36], U: [-0.2, 0.36], R: [0.1, 0.38], L: [-0.1, 0.38] };
const WCOL = { sword: '#d8dde6', blade: '#e0d8c8', spear: '#b8a888', bow: '#8a5a32', staff: '#7a5aa8', dagger: '#c8ccd4', gauntlet: '#6a6a78' };

function atlasFrame(A, name) {
  const W = A.weapons && A.weapons[name];
  return W && W.w && !W.missing ? W : null;
}

// 무기: weapons 아틀라스에 'w_<아이템id>' 또는 'w_<종류>' 그림이 있으면 그걸 손 위치에 붙이고, 없으면 코드로 간단히 그린다.
export function drawWeapon(g, ctx, ch, item, h, behind) {
  if (!item) return;
  const dir = ch.dir || 'D';
  if ((dir === 'U') !== !!behind) return;   // 위를 볼 때는 몸 뒤에
  const [hx, hy] = HAND[dir], x = ch.x + hx * h, y = ch.y - hy * h;
  const ang = ch.swing != null ? ch.swing : ({ D: 0.5, U: -2.6, R: -0.7, L: Math.PI + 0.7 })[dir];
  // 새 무기 그림(items2): 세워진 그림을 손잡이 기준으로 회전해 붙인다
  const I2 = g.A.items2, key = item.ego && g.gear ? item.id + '_' + g.gear.egoStageOf(item.id) : item.id, a2 = I2 && I2[key] && I2[key].w && !I2[key].missing ? I2[key] : null;
  if (a2) {
    const len = { sword: 0.62, blade: 0.6, spear: 0.95, bow: 0.62, staff: 0.9, dagger: 0.38, gauntlet: 0.3 }[item.type] || 0.6, k = h * len / a2.h;
    ctx.save(); ctx.translate(Math.round(x), Math.round(y));
    if (item.type === 'gauntlet') ctx.drawImage(a2.im, -a2.w * k / 2, -a2.h * k / 2, a2.w * k, a2.h * k);
    else { ctx.rotate(ang + Math.PI); ctx.drawImage(a2.im, -a2.w * k / 2, -a2.h * k * 0.9, a2.w * k, a2.h * k); }
    ctx.restore(); return;
  }
  const art = atlasFrame(g.A, 'w_' + item.id) || atlasFrame(g.A, 'w_' + item.type);
  ctx.save(); ctx.translate(Math.round(x), Math.round(y));
  if (art) { ctx.rotate(ang); const s = h / 130; ctx.drawImage(art.im, -art.ax * s, -art.ay * s, art.w * s, art.h * s); ctx.restore(); return; }
  const u = h / 64, col = WCOL[item.type] || '#ccc';
  ctx.rotate(ang);
  ctx.fillStyle = '#1a1420';
  const shape = {
    sword: [[-1, -2, 3, 26], [-4, -2, 9, 3]], blade: [[-1, -2, 4, 24], [-3, -2, 8, 3]], dagger: [[-1, -1, 3, 13], [-3, -1, 7, 2]],
    spear: [[-1, -14, 2, 44], [-2, 28, 4, 6]], staff: [[-1, -12, 3, 38], [-3, 24, 7, 7]], bow: [[-1, -14, 3, 30]], gauntlet: [[-4, -3, 8, 7]],
  }[item.type] || [[-1, -2, 3, 20]];
  for (const [a, b, w2, h2] of shape) ctx.fillRect((a - 1) * u, (b - 1) * u, (w2 + 2) * u, (h2 + 2) * u);
  ctx.fillStyle = col;
  for (const [a, b, w2, h2] of shape) ctx.fillRect(a * u, b * u, w2 * u, h2 * u);
  ctx.restore();
}

// 가면: 'm_<아이템id>' 그림이 있으면 얼굴에 붙이고, 없으면 코드로 얼굴 아래쪽을 가린다.
export function drawMask(g, ctx, ch, item, h) {
  if (!item || ch.dir === 'U') return;
  const I2 = g.A.items2, a2 = I2 && I2[item.id] && I2[item.id].w && !I2[item.id].missing ? I2[item.id] : null;
  if (a2) { const fx2 = ch.x + (ch.dir === 'R' ? 0.06 : ch.dir === 'L' ? -0.06 : 0) * h, fy2 = ch.y - 0.7 * h, w2 = h * (ch.dir === 'R' || ch.dir === 'L' ? 0.2 : 0.3); ctx.drawImage(a2.im, fx2 - w2 / 2, fy2 - w2 / 2, w2, w2); return; }
  const art = atlasFrame(g.A, 'm_' + item.id);
  const side = ch.dir === 'R' || ch.dir === 'L', fx = ch.x + (side ? (ch.dir === 'R' ? 0.07 : -0.07) * h : 0), fy = ch.y - 0.66 * h;
  if (art) { const s = h / 130; ctx.save(); if (ch.dir === 'L') { ctx.translate(fx, fy); ctx.scale(-1, 1); ctx.translate(-fx, -fy); } ctx.drawImage(art.im, fx - art.ax * s, fy - art.ay * s, art.w * s, art.h * s); ctx.restore(); return; }
  const w = (side ? 0.16 : 0.26) * h, hh = 0.09 * h;
  ctx.fillStyle = '#1a1420'; ctx.fillRect(fx - w / 2 - 1, fy - 1, w + 2, hh + 2);
  ctx.fillStyle = item.id === 'mask_1' ? '#2a2a30' : '#e8e4dc'; ctx.fillRect(fx - w / 2, fy, w, hh);
  if (item.id !== 'mask_1') { ctx.fillStyle = '#1a1420'; ctx.fillRect(fx - w * 0.3, fy + hh * 0.25, w * 0.18, hh * 0.25); if (!side) ctx.fillRect(fx + w * 0.12, fy + hh * 0.25, w * 0.18, hh * 0.25); }
}

// 쓰러짐(기절·사망) 자세: 옆으로 눕힌다
export function lying(ctx, ch, fn, k = 1) {
  ctx.save(); ctx.translate(ch.x, ch.y); ctx.rotate(-Math.PI / 2 * k); ctx.translate(-ch.x, -ch.y + 10); fn(); ctx.restore();
}

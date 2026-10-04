// 사람 그림: 받은 캐릭터 시트(chars 아틀라스)가 있으면 그걸 쓰고, 없으면 코드 도트로 그린다.
import { makePerson } from './pixel.js';

export function charKey(g, id) {
  const f = g.state && g.state.gender === 'f';
  if (id === 'player') return f ? 'player_f' : 'player_m';
  if (id === 'seoyun') return f ? 'seoyun_m' : 'seoyun_f';
  return id;
}

export function framesFor(g, id, look) {
  const C = g.A.chars && g.A.chars[charKey(g, id)];
  if (C && C.D && C.D.length && !C.D[0].missing) return { big: true, C, P: null };
  return { big: false, C: null, P: makePerson(look) };
}

// h: 화면에서의 키(px). 시트 그림은 키 100px로 맞춰져 있다.
export function drawPerson(v, a, h, alpha = 1, pixelScale = 3.2) {
  const fr = a.fr;
  v.shadow(a.x, a.y, h * 0.2);
  if (fr && fr.big) {
    const C = fr.C, list = a.dir === 'L' ? C.R : C[a.dir] || C.D;
    let f;
    if (a.pose && C[a.pose] && C[a.pose].length) f = C[a.pose][Math.min(C[a.pose].length - 1, Math.floor((a.poseT || 0) * 10))];
    else f = a.moving ? list[Math.floor(a.t * (a.running ? 14 : 9)) % list.length] : list[0];
    v.sprite(f, a.x, a.y, h / 100, a.dir === 'L', alpha);
    return;
  }
  const P = fr ? fr.P : a.frames, f = a.dir === 'L' ? P.R : P[a.dir];
  const step = a.moving ? [1, 0, 2, 0][Math.floor(a.t * 8) % 4] : 0;
  v.sprite(f[step], a.x, a.y, pixelScale, a.dir === 'L', alpha);
}

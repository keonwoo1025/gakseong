// 임시 그림 생성기: 디자인이 나오기 전까지 사람, 초상화, 타일을 코드로 그린다.
// 나중에 AI 그림이 들어오면 manifest에 같은 이름이 생기고, 그쪽이 우선 쓰인다.

const OL = '#1a1420';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function outline(c) {
  const x = c.getContext('2d'), W = c.width, H = c.height;
  const d = x.getImageData(0, 0, W, H), p = d.data, add = [];
  const a = (i) => p[i * 4 + 3] > 0;
  for (let y = 0; y < H; y++) for (let X = 0; X < W; X++) {
    const i = y * W + X; if (a(i)) continue;
    if ((X > 0 && a(i - 1)) || (X < W - 1 && a(i + 1)) || (y > 0 && a(i - W)) || (y < H - 1 && a(i + W))) add.push([X, y]);
  }
  x.fillStyle = OL; for (const [X, y] of add) x.fillRect(X, y, 1, 1);
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r * k))); g = Math.max(0, Math.min(255, Math.round(g * k))); b = Math.max(0, Math.min(255, Math.round(b * k)));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

// ---------- 사람 (16x24 도트, 1px 여백) ----------
// look: { skin, hair, hairStyle: short|long|bun|bob|bald, top, bottom, shoes, accent }
function drawPerson(x, look, dir, step) {
  const R = (c, X, Y, w = 1, h = 1) => { x.fillStyle = c; x.fillRect(X + 1, Y + 1, w, h); };
  const skin = look.skin || '#f2cfb1', hair = look.hair || '#2a2230', top = look.top || '#2b2b33', bot = look.bottom || '#5a5e6b', shoe = look.shoes || '#2a2420';
  const hs = look.hairStyle || 'short';
  const legA = step === 1 ? -1 : 0, legB = step === 2 ? -1 : 0;
  if (dir === 'D' || dir === 'U') {
    // 다리
    R(bot, 5, 17 + legA, 2, 5 - legA); R(bot, 9, 17 + legB, 2, 5 - legB);
    R(shoe, 5, 22, 2, 1); R(shoe, 9, 22, 2, 1);
    // 몸통과 팔
    R(top, 4, 12, 8, 6); R(shade(top, 0.8), 4, 16, 8, 1);
    const armA = step === 1 ? 1 : 0, armB = step === 2 ? 1 : 0;
    R(top, 3, 12, 1, 3 + armB); R(top, 12, 12, 1, 3 + armA);
    R(skin, 3, 15 + armB, 1, 1); R(skin, 12, 15 + armA, 1, 1);
    if (look.accent) R(look.accent, 4, 16, 8, 1);
    // 머리
    if (hs === 'long' && dir === 'U') R(hair, 3, 6, 10, 9);
    if (hs === 'long' && dir === 'D') { R(hair, 3, 5, 1, 9); R(hair, 12, 5, 1, 9); }
    R(skin, 4, 2, 8, 9); R(shade(skin, 0.9), 4, 10, 8, 1);
    if (dir === 'D') {
      R(OL, 6, 7, 1, 2); R(OL, 9, 7, 1, 2);
      R(shade(skin, 0.8), 7, 9, 2, 1);
    }
    if (hs !== 'bald') {
      R(hair, 4, 1, 8, 3); R(hair, 3, 2, 1, 4); R(hair, 12, 2, 1, 4);
      if (dir === 'D') { R(hair, 4, 4, 2, 1); R(hair, 10, 4, 2, 1); R(hair, 7, 4, 1, 1); }
      if (dir === 'U') R(hair, 4, 2, 8, 8);
      if (hs === 'bun') R(hair, 6, -1, 4, 2);
      if (hs === 'bob') { R(hair, 3, 5, 1, 4); R(hair, 12, 5, 1, 4); if (dir === 'U') R(hair, 4, 8, 8, 2); }
      R(shade(hair, 1.35), 5, 1, 3, 1);
    } else { R(shade(skin, 0.85), 4, 1, 8, 2); }
  } else {
    // 옆모습 (오른쪽)
    const f = step === 1 ? 1 : step === 2 ? -1 : 0;
    R(bot, 6 + f, 17, 2, 5); R(bot, 8 - f, 17, 2, 5);
    R(shoe, 6 + f, 22, 3, 1); R(shoe, 8 - f, 22, 3, 1);
    R(top, 5, 12, 6, 6); R(shade(top, 0.8), 5, 16, 6, 1);
    R(top, 7 - f, 12, 2, 4); R(skin, 7 - f, 16, 2, 1);
    if (look.accent) R(look.accent, 5, 16, 6, 1);
    if (hs === 'long') R(hair, 4, 4, 3, 10);
    R(skin, 5, 2, 7, 9); R(OL, 10, 7, 1, 2); R(shade(skin, 0.8), 10, 9, 1, 1);
    if (hs !== 'bald') {
      R(hair, 4, 1, 8, 3); R(hair, 4, 2, 3, 6); R(shade(hair, 1.35), 6, 1, 3, 1);
      if (hs === 'bun') R(hair, 3, 0, 3, 3);
      if (hs === 'bob') R(hair, 4, 5, 3, 5);
    }
  }
  parts(R, look, dir, step, hair, top, bot);
}

// 파츠: 옷 종류(셔츠·후드·정장·작업복·헌터복·원피스), 안경, 추가 머리(포니테일·삐죽머리)
function parts(R, look, dir, step, hair, top, bot) {
  const o = look.outfit || 'shirt', side = dir === 'R', hs = look.hairStyle;
  if (o === 'hoodie') { if (dir === 'U') R(shade(top, 0.85), 4, 8, 8, 3); else if (side) R(shade(top, 0.8), 4, 10, 3, 3); else { R(shade(top, 0.8), 4, 11, 8, 1); R('#e8e4dc', 6, 13, 1, 2); R('#e8e4dc', 9, 13, 1, 2); } }
  if (o === 'suit') { if (dir === 'D') { R('#e8e4dc', 7, 12, 2, 3); R('#5a2a3a', 7, 13, 1, 3); } else if (side) R('#e8e4dc', 9, 12, 1, 2); }
  if (o === 'work') { if (side) R(bot, 7, 12, 1, 5); else { R(bot, 5, 12, 1, 5); R(bot, 10, 12, 1, 5); } }
  if (o === 'hunter') { const m = '#6a6a78'; if (side) R(m, 6, 12, 3, 2); else { R(m, 3, 12, 2, 2); R(m, 11, 12, 2, 2); R('#4a3a2a', 4, 16, 8, 1); } }
  if (o === 'dress') { if (side) R(top, 5, 17, 6, 3); else { R(top, 4, 17, 8, 3); R(shade(top, 0.85), 4, 19, 8, 1); } }
  if (look.glasses && dir !== 'U') { const c = '#3a3a44'; if (side) R(c, 9, 6, 3, 1); else { R(c, 5, 6, 3, 1); R(c, 9, 6, 3, 1); R(c, 8, 7, 1, 1); } }
  if (hs === 'ponytail') { if (dir === 'U') R(hair, 7, 8, 2, 6); else if (side) R(hair, 3, 4, 2, 6); else R(hair, 12, 4, 1, 3); }
  if (hs === 'spiky') { if (side) { R(hair, 6, 0, 1, 1); R(hair, 9, 0, 1, 1); } else { R(hair, 5, 0, 1, 1); R(hair, 8, 0, 1, 1); R(hair, 10, 0, 1, 1); } }
}

export function makePerson(look) {
  const out = {};
  for (const dir of ['D', 'U', 'R']) {
    out[dir] = [0, 1, 2].map((step) => {
      const c = canvas(18, 26);
      drawPerson(c.getContext('2d'), look, dir, step);
      outline(c);
      return { im: c, w: c.width, h: c.height, ax: 9, ay: 25 };
    });
  }
  return out;
}

export function makePortrait(look) {
  const c = canvas(34, 34), x = c.getContext('2d');
  const R = (col, X, Y, w = 1, h = 1) => { x.fillStyle = col; x.fillRect(X, Y, w, h); };
  const skin = look.skin || '#f2cfb1', hair = look.hair || '#2a2230', top = look.top || '#2b2b33', hs = look.hairStyle || 'short';
  R(top, 5, 25, 24, 9); R(shade(top, 0.8), 5, 31, 24, 3);
  R(skin, 14, 21, 6, 5);
  if (hs === 'long') { R(hair, 6, 8, 4, 20); R(hair, 24, 8, 4, 20); }
  R(skin, 9, 6, 16, 17); R(shade(skin, 0.9), 9, 21, 16, 2);
  R(OL, 12, 13, 2, 3); R(OL, 20, 13, 2, 3); R('#ffffff', 12, 13, 1, 1); R('#ffffff', 20, 13, 1, 1);
  R(shade(skin, 0.75), 16, 19, 3, 1);
  if (hs !== 'bald') {
    R(hair, 8, 3, 18, 6); R(hair, 7, 5, 2, 9); R(hair, 25, 5, 2, 9);
    R(hair, 9, 9, 4, 2); R(hair, 21, 9, 4, 2); R(hair, 15, 9, 3, 1);
    if (hs === 'bun') R(hair, 13, 0, 8, 4);
    if (hs === 'bob') { R(hair, 7, 12, 3, 8); R(hair, 24, 12, 3, 8); }
    R(shade(hair, 1.35), 11, 4, 6, 1);
  } else R(shade(skin, 0.85), 9, 5, 16, 3);
  if (look.accent) R(look.accent, 5, 25, 24, 1);
  outline(c);
  return { im: c, w: c.width, h: c.height, ax: 17, ay: 17 };
}

// ---------- 타일 (16x16 도트) ----------
const THEMES = {
  street: { floor: '#7c7f86', alt: '#73767d', wall: '#b9a58c', wallTop: '#8d7b67', trim: '#5f5246' },
  office: { floor: '#c9c2b0', alt: '#beb7a5', wall: '#e6e1d6', wallTop: '#a9a397', trim: '#7f7a70' },
  factory: { floor: '#8b8f86', alt: '#80847b', wall: '#9aa3a8', wallTop: '#6b7378', trim: '#4f565b' },
  room: { floor: '#b88a5a', alt: '#a97d50', wall: '#e9dcc4', wallTop: '#bba98c', trim: '#8a7558' },
  store: { floor: '#e5e7ea', alt: '#d8dade', wall: '#f4f4f0', wallTop: '#c2c8cc', trim: '#3f8f5a' },
  porter: { floor: '#9a8670', alt: '#8f7c66', wall: '#7d6e5f', wallTop: '#5a4f45', trim: '#3d352e' },
  plaza: { floor: '#b9b4a8', alt: '#aea99d', wall: '#6d6a7a', wallTop: '#4d4a5a', trim: '#c9a24a' },
  rift: { floor: '#2a1a24', alt: '#3a2030', wall: '#1a1018', wallTop: '#0e080c', trim: '#7a1a2a' },
  roof: { floor: '#9ea2a0', alt: '#939795', wall: '#6f7472', wallTop: '#575b59', trim: '#3d4140' },
};

function noise(x, base, alt, n, seed) {
  let s = seed;
  for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; const X = s % 16; s = (s * 16807) % 2147483647; const Y = s % 16; x.fillStyle = alt; x.fillRect(X, Y, 1, 1); }
}

const PAINT = {
  floor(x, T, s) { x.fillStyle = T.floor; x.fillRect(0, 0, 16, 16); noise(x, T.floor, T.alt, 10, s); },
  wood(x, T) { x.fillStyle = T.floor; x.fillRect(0, 0, 16, 16); x.fillStyle = T.alt; for (let y = 3; y < 16; y += 4) x.fillRect(0, y, 16, 1); x.fillRect(5, 0, 1, 3); x.fillRect(11, 4, 1, 3); x.fillRect(3, 8, 1, 3); x.fillRect(9, 12, 1, 3); },
  tile(x, T) { x.fillStyle = T.floor; x.fillRect(0, 0, 16, 16); x.fillStyle = T.alt; x.fillRect(0, 15, 16, 1); x.fillRect(15, 0, 1, 16); x.fillStyle = shade(T.floor, 1.06); x.fillRect(1, 1, 6, 1); },
  road(x) { x.fillStyle = '#4a4d55'; x.fillRect(0, 0, 16, 16); noise(x, 0, '#43464d', 14, 7); },
  lane(x) { PAINT.road(x); x.fillStyle = '#e6e2c8'; x.fillRect(2, 7, 12, 2); },
  walk(x) { x.fillStyle = '#a7a39a'; x.fillRect(0, 0, 16, 16); x.fillStyle = '#958f84'; x.fillRect(0, 7, 16, 1); x.fillRect(7, 0, 1, 7); x.fillRect(12, 8, 1, 8); },
  grass(x) { x.fillStyle = '#5aa63c'; x.fillRect(0, 0, 16, 16); noise(x, 0, '#4f9534', 14, 3); noise(x, 0, '#6cbb4a', 8, 11); },
  wall(x, T) { x.fillStyle = T.wall; x.fillRect(0, 0, 16, 16); x.fillStyle = T.wallTop; x.fillRect(0, 0, 16, 4); x.fillStyle = T.trim; x.fillRect(0, 14, 16, 2); x.fillStyle = shade(T.wall, 0.94); x.fillRect(0, 8, 16, 1); },
  window(x, T) { PAINT.wall(x, T); x.fillStyle = '#7fb3d6'; x.fillRect(3, 5, 10, 7); x.fillStyle = '#b9dcf0'; x.fillRect(4, 6, 3, 2); x.fillStyle = T.trim; x.fillRect(7, 5, 1, 7); x.fillRect(3, 8, 10, 1); },
  door(x, T) { x.fillStyle = T.floor; x.fillRect(0, 0, 16, 16); x.fillStyle = '#6b4a2e'; x.fillRect(2, 0, 12, 16); x.fillStyle = '#86603d'; x.fillRect(3, 1, 10, 14); x.fillStyle = '#d9b45a'; x.fillRect(11, 8, 1, 2); },
  exit(x) { x.fillStyle = '#2f3a2f'; x.fillRect(0, 0, 16, 16); x.fillStyle = '#4fbf6a'; x.fillRect(4, 3, 8, 4); x.fillStyle = '#e8ffe8'; x.fillRect(5, 4, 6, 2); },
  desk(x, T) { PAINT.floor(x, T, 5); x.fillStyle = '#8a6a4a'; x.fillRect(1, 4, 14, 8); x.fillStyle = '#a5825e'; x.fillRect(1, 4, 14, 2); x.fillStyle = '#3a3f4a'; x.fillRect(5, 1, 6, 4); x.fillStyle = '#7fb3d6'; x.fillRect(6, 2, 4, 2); },
  chair(x, T) { PAINT.floor(x, T, 9); x.fillStyle = '#3a3f4a'; x.fillRect(5, 5, 6, 7); x.fillStyle = '#4c5260'; x.fillRect(5, 5, 6, 2); },
  bed(x, T) { PAINT.floor(x, T, 2); x.fillStyle = '#e8e8f0'; x.fillRect(1, 1, 14, 14); x.fillStyle = '#5a7fb0'; x.fillRect(1, 6, 14, 9); x.fillStyle = '#ffffff'; x.fillRect(3, 2, 10, 3); },
  shelf(x, T) { PAINT.wall(x, T); x.fillStyle = '#7a5a3a'; x.fillRect(1, 2, 14, 13); const cols = ['#d84a4a', '#4a8ad8', '#e8c84a', '#5ab05a', '#c86ad8']; for (let i = 0; i < 6; i++) { x.fillStyle = cols[i % 5]; x.fillRect(2 + (i % 3) * 4, 4 + Math.floor(i / 3) * 5, 3, 3); } },
  counter(x, T) { PAINT.floor(x, T, 4); x.fillStyle = '#5a6a7a'; x.fillRect(0, 3, 16, 10); x.fillStyle = '#7a8a9a'; x.fillRect(0, 3, 16, 3); },
  machine(x) { x.fillStyle = '#5d646a'; x.fillRect(0, 0, 16, 16); x.fillStyle = '#7b848b'; x.fillRect(1, 1, 14, 5); x.fillStyle = '#e0a13a'; x.fillRect(2, 8, 12, 2); x.fillStyle = '#2b3035'; x.fillRect(3, 11, 4, 4); x.fillRect(9, 11, 4, 4); x.fillStyle = '#d84a4a'; x.fillRect(12, 2, 2, 2); },
  belt(x) { x.fillStyle = '#3b3f44'; x.fillRect(0, 2, 16, 12); x.fillStyle = '#555b62'; for (let i = 0; i < 16; i += 4) x.fillRect(i, 4, 2, 8); },
  plant(x, T) { PAINT.floor(x, T, 6); x.fillStyle = '#8a5a3a'; x.fillRect(5, 10, 6, 5); x.fillStyle = '#3f9a4a'; x.fillRect(3, 2, 10, 9); x.fillStyle = '#5ab85f'; x.fillRect(5, 3, 4, 3); },
  sofa(x, T) { PAINT.floor(x, T, 8); x.fillStyle = '#8a4a4a'; x.fillRect(0, 4, 16, 10); x.fillStyle = '#a65a5a'; x.fillRect(0, 4, 16, 4); },
  board(x, T) { PAINT.wall(x, T); x.fillStyle = '#6b4a2e'; x.fillRect(1, 2, 14, 11); x.fillStyle = '#e9e2cc'; x.fillRect(2, 3, 5, 4); x.fillRect(8, 3, 6, 3); x.fillRect(3, 8, 6, 4); x.fillStyle = '#d84a4a'; x.fillRect(4, 3, 1, 1); x.fillRect(10, 3, 1, 1); },
  screen(x) { x.fillStyle = '#2a2a33'; x.fillRect(0, 0, 16, 16); x.fillStyle = '#3a8ad8'; x.fillRect(1, 2, 14, 10); x.fillStyle = '#e8f4ff'; x.fillRect(2, 4, 8, 1); x.fillRect(2, 7, 11, 1); x.fillRect(2, 9, 6, 1); x.fillStyle = '#555'; x.fillRect(7, 12, 2, 4); },
  fence(x, T) { PAINT.floor(x, T, 3); x.fillStyle = '#5b6062'; x.fillRect(0, 3, 16, 2); x.fillRect(0, 9, 16, 2); for (let i = 1; i < 16; i += 5) x.fillRect(i, 1, 2, 13); },
  tree(x) { PAINT.walk(x); x.fillStyle = '#6b4a2e'; x.fillRect(7, 10, 2, 6); x.fillStyle = '#3f8a3f'; x.fillRect(2, 1, 12, 10); x.fillStyle = '#5aa65a'; x.fillRect(4, 2, 5, 4); },
  crate(x, T) { PAINT.floor(x, T, 12); x.fillStyle = '#9a7040'; x.fillRect(2, 3, 12, 11); x.fillStyle = '#7a5530'; x.fillRect(2, 8, 12, 1); x.fillRect(7, 3, 1, 11); },
  gate(x) { x.fillStyle = '#2a2638'; x.fillRect(0, 0, 16, 16); x.fillStyle = '#6a4ad8'; x.fillRect(3, 3, 10, 13); x.fillStyle = '#b89aff'; x.fillRect(5, 5, 6, 11); x.fillStyle = '#e8dcff'; x.fillRect(7, 7, 2, 9); },
  pillar(x, T) { x.fillStyle = T.wall; x.fillRect(0, 0, 16, 16); x.fillStyle = T.trim; x.fillRect(0, 0, 16, 2); x.fillRect(0, 14, 16, 2); x.fillStyle = shade(T.wall, 1.2); x.fillRect(4, 2, 3, 12); },
  rug(x) { x.fillStyle = '#7a3a4a'; x.fillRect(0, 0, 16, 16); x.fillStyle = '#9a5a6a'; x.fillRect(2, 2, 12, 12); x.fillStyle = '#7a3a4a'; x.fillRect(4, 4, 8, 8); },
  fridge(x, T) { PAINT.wall(x, T); x.fillStyle = '#dfe8ee'; x.fillRect(2, 1, 12, 15); x.fillStyle = '#7fb3d6'; x.fillRect(3, 2, 10, 9); x.fillStyle = '#e8c84a'; x.fillRect(4, 4, 2, 2); x.fillRect(8, 6, 2, 2); x.fillStyle = '#5ab05a'; x.fillRect(10, 3, 2, 3); },
  sign(x) { PAINT.walk(x); x.fillStyle = '#3a3f4a'; x.fillRect(7, 8, 2, 8); x.fillStyle = '#c9a24a'; x.fillRect(2, 2, 12, 7); x.fillStyle = '#2a1a10'; x.fillRect(4, 4, 8, 1); x.fillRect(4, 6, 6, 1); },
  water(x) { x.fillStyle = '#3a78b8'; x.fillRect(0, 0, 16, 16); x.fillStyle = '#5a98d0'; x.fillRect(2, 4, 5, 1); x.fillRect(9, 10, 5, 1); x.fillStyle = '#2f68a0'; x.fillRect(6, 13, 4, 1); },
  bench(x) { PAINT.grass(x); x.fillStyle = '#8a5a3a'; x.fillRect(1, 6, 14, 3); x.fillRect(1, 10, 14, 2); x.fillStyle = '#4a4a4a'; x.fillRect(2, 12, 1, 3); x.fillRect(13, 12, 1, 3); },
  stall(x) { PAINT.walk(x); x.fillStyle = '#d84a4a'; x.fillRect(0, 1, 16, 4); x.fillStyle = '#f4f4f0'; for (let i = 0; i < 16; i += 4) x.fillRect(i, 1, 2, 4); x.fillStyle = '#9a7040'; x.fillRect(1, 7, 14, 7); x.fillStyle = '#e8c84a'; x.fillRect(3, 8, 3, 2); x.fillStyle = '#5ab05a'; x.fillRect(8, 8, 3, 2); },
  lamp(x) { PAINT.walk(x); x.fillStyle = '#3a3f4a'; x.fillRect(7, 3, 2, 13); x.fillStyle = '#ffe9a8'; x.fillRect(5, 1, 6, 3); },
  sand(x) { x.fillStyle = '#d8c89a'; x.fillRect(0, 0, 16, 16); noise(x, 0, '#c8b88a', 12, 5); },
  void(x) { x.fillStyle = '#14110f'; x.fillRect(0, 0, 16, 16); },
};

export const SOLID = new Set(['water', 'bench', 'stall', 'lamp', 'wall', 'window', 'desk', 'bed', 'shelf', 'counter', 'machine', 'belt', 'plant', 'sofa', 'board', 'screen', 'fence', 'tree', 'crate', 'pillar', 'fridge', 'sign', 'void']);

export function makeTiles(theme) {
  const T = THEMES[theme] || THEMES.street;
  const tiles = {};
  let seed = 1;
  for (const name in PAINT) {
    const c = canvas(16, 16), x = c.getContext('2d');
    PAINT[name](x, T, (seed += 37));
    tiles[name] = c;
  }
  return tiles;
}

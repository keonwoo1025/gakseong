// 그림 불러오기: data/manifest.json에 적힌 아틀라스(분류별 그림 한 장)를 읽고, 프레임별로 잘라 쓴다.
// 기준점(발 위치 등)은 자동 계산한다. 그림 교체는 Claude가 아틀라스와 manifest를 새로 만들어 주는 방식.

const MODES = {
  sprites: 'feet',
  monsters: 'feet',
  props: 'bottom',
  fx: 'center',
  weapons: 'center',
  portraits: 'center',
  tiles: 'none',
};

function computeAnchor(o, mode) {
  if (mode === 'none') { o.ax = 0; o.ay = 0; return; }
  if (mode === 'center') { o.ax = o.w / 2; o.ay = o.h / 2; return; }
  if (mode === 'bottom') { o.ax = o.w / 2; o.ay = o.h; return; }
  const x = o.im.getContext('2d', { willReadFrequently: true });
  const d = x.getImageData(0, 0, o.w, o.h).data;
  let bottom = -1;
  for (let y = o.h - 1; y >= 0 && bottom < 0; y--) {
    for (let X = 0; X < o.w; X++) if (d[(y * o.w + X) * 4 + 3] > 100) { bottom = y; break; }
  }
  if (bottom < 0) { o.ax = o.w / 2; o.ay = o.h; return; }
  let sx = 0, n = 0;
  for (let y = Math.max(0, bottom - 12); y <= bottom; y++) {
    for (let X = 0; X < o.w; X++) if (d[(y * o.w + X) * 4 + 3] > 100) { sx += X; n++; }
  }
  o.ax = n ? sx / n : o.w / 2;
  o.ay = bottom + 1;
}

function placeholderCanvas(mode) {
  const c = document.createElement('canvas');
  const size = mode === 'none' ? [88, 96] : mode === 'feet' ? [48, 96] : [64, 64];
  c.width = size[0]; c.height = size[1];
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(200,60,180,0.55)'; x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = '#fff'; x.strokeRect(1, 1, c.width - 2, c.height - 2);
  x.fillStyle = '#fff'; x.font = '10px sans-serif'; x.fillText('그림 없음', 4, 14);
  return c;
}

function loadImage(src) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });
}

export async function loadAssets(url, onProgress) {
  const man = await (await fetch(url + '?t=' + Date.now(), { cache: 'no-store' })).json();
  const ver = man.version || '0';
  const cats = Object.keys(man.atlases);
  let done = 0;
  const A = { version: ver };
  for (const cat of cats) {
    const info = man.atlases[cat];
    const mode = MODES[cat] || 'center';
    const sheet = await loadImage(info.file + '?v=' + ver);
    const cut = (r) => {
      const o = { w: 0, h: 0, ax: 0, ay: 0 };
      if (sheet && r) {
        const c = document.createElement('canvas');
        c.width = r[2]; c.height = r[3];
        c.getContext('2d').drawImage(sheet, r[0], r[1], r[2], r[3], 0, 0, r[2], r[3]);
        o.im = c;
      } else { o.im = placeholderCanvas(mode); o.missing = true; }
      o.w = o.im.width; o.h = o.im.height;
      try { computeAnchor(o, o.missing && mode === 'feet' ? 'bottom' : mode); } catch (e) { o.ax = o.w / 2; o.ay = o.h; }
      return o;
    };
    const walk = (n) => {
      if (Array.isArray(n) && n.length === 4 && typeof n[0] === 'number') return cut(n);
      if (Array.isArray(n)) return n.map(walk);
      const out = {};
      for (const k in n) out[k] = walk(n[k]);
      return out;
    };
    A[cat] = walk(info.frames);
    done++; onProgress && onProgress(done, cats.length);
  }
  return A;
}

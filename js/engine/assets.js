// 그림 불러오기: data/manifest.json에 적힌 파일을 읽고, 기준점(발 위치 등)을 자동으로 계산한다.
// 그림을 교체할 때는 같은 이름의 PNG만 바꾸면 기준점이 다시 계산된다.

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
  const c = document.createElement('canvas');
  c.width = o.w; c.height = o.h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(o.im, 0, 0);
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

// 그림이 없거나 깨졌을 때 쓰는 임시 모양
function placeholder(o, mode) {
  const c = document.createElement('canvas');
  const size = mode === 'none' ? [88, 96] : mode === 'feet' ? [48, 96] : [64, 64];
  c.width = size[0]; c.height = size[1];
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(200,60,180,0.55)'; x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = '#fff'; x.strokeRect(1, 1, c.width - 2, c.height - 2);
  x.fillStyle = '#fff'; x.font = '10px sans-serif'; x.fillText('그림 없음', 4, 14);
  o.im = c; o.w = c.width; o.h = c.height; o.missing = true;
  computeAnchor(o, mode === 'feet' ? 'bottom' : mode);
}

export async function loadAssets(url, onProgress) {
  const man = await (await fetch(url + '?t=' + Date.now(), { cache: 'no-store' })).json();
  const ver = man.version || '0';
  delete man.version;
  const jobs = [];
  let total = 0, done = 0;

  function image(src, mode) {
    total++;
    const o = { src, im: new Image(), w: 0, h: 0, ax: 0, ay: 0 };
    jobs.push(new Promise((res) => {
      o.im.onload = () => {
        o.w = o.im.width; o.h = o.im.height;
        try { computeAnchor(o, mode); } catch (e) { o.ax = o.w / 2; o.ay = o.h; }
        done++; onProgress && onProgress(done, total); res();
      };
      o.im.onerror = () => { placeholder(o, mode); done++; onProgress && onProgress(done, total); res(); };
      o.im.src = src + '?v=' + ver;
    }));
    return o;
  }

  function walk(node, mode) {
    if (typeof node === 'string') return image(node, mode);
    if (Array.isArray(node)) return node.map((n) => walk(n, mode));
    const out = {};
    for (const k in node) out[k] = walk(node[k], mode);
    return out;
  }

  const A = {};
  for (const cat in man) A[cat] = walk(man[cat], MODES[cat] || 'center');
  await Promise.all(jobs);
  A.version = ver;
  return A;
}

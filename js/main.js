import { Game } from './game/game.js';

const game = new Game(document.getElementById('game'), document.getElementById('overlay'));
window.__game = game; // 개발 확인용
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try { game.update(dt); game.render(); } catch (e) { console.error(e); }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
game.boot().catch((e) => {
  console.error(e);
  document.getElementById('overlay').innerHTML = '<div class="screen"><div class="card"><h2>불러오기에 실패했어요</h2><p class="hint">로컬 파일로 열면 동작하지 않아요. 깃허브 페이지 같은 웹 주소에서 열어주세요.</p></div></div>';
});

// 휴대폰: 첫 터치 때 전체 화면 + 가로 고정을 시도한다 (안드로이드 크롬 지원, 아이폰은 회전 안내만 표시)
const coarse = window.matchMedia('(pointer: coarse)').matches;
const standalone = window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
function goLandscape() {
  if (!coarse) return;
  const lock = () => { try { const p = screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'); if (p && p.catch) p.catch(() => {}); } catch (e) {} };
  if (!standalone && document.fullscreenEnabled && !document.fullscreenElement) {
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(lock).catch(() => {});
  } else lock();
}
window.addEventListener('pointerdown', goLandscape, { once: true });
window.addEventListener('pointerdown', () => game.sound.unlock());
window.addEventListener('keydown', () => game.sound.unlock());

// 홈 화면 설치용 (이 폴더 범위에서만 동작해서 다른 앱과 겹치지 않음)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});

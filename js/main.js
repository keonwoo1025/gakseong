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

// 조작과 화면 설정 (기기에 저장, 게임 기록과 별도)
const KEY = 'gakseong_settings';
export const DEFAULTS = {
  joyMode: 'fixed',     // fixed: 왼쪽 아래 고정, float: 닿은 곳에서 시작
  joySize: 'm',         // s m l
  sens: 'm',            // 민감도 s m l (높을수록 조금만 밀어도 최대)
  runAt: 'm',           // 달리기 전환 지점 s(빨리) m l(끝까지)
  btnSize: 'm',
  btnAlpha: 'm',
  lefty: false,         // 왼손 모드: 조이스틱과 버튼 좌우 바꿈
  zoom: 'm',            // 가깝게 s, 보통 m, 멀게 l
  swipeDodge: true,     // 빈 곳을 밀면 회피
  btnPos: {},           // 버튼별 위치 이동값
};
export const Settings = {
  v: { ...DEFAULTS },
  load() { try { Object.assign(this.v, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {} return this.v; },
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.v)); } catch (e) {} },
  joyRadius() { return { s: 48, m: 60, l: 74 }[this.v.joySize]; },
  sensK() { return { s: 1.0, m: 0.8, l: 0.62 }[this.v.sens]; },
  runK() { return { s: 0.7, m: 0.85, l: 0.97 }[this.v.runAt]; },
  btnK() { return { s: 0.85, m: 1, l: 1.2 }[this.v.btnSize]; },
  alpha() { return { s: 0.35, m: 0.6, l: 0.85 }[this.v.btnAlpha]; },
  tilesTall() { return { s: 4.6, m: 5.6, l: 6.8 }[this.v.zoom]; },
};
Settings.load();

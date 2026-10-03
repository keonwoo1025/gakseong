// 이름 뒤 조사 자동 처리. 대사에서 {이름:아} {이름:이} {성이름:은} 처럼 쓴다.

const PAIRS = {
  '이': ['이', '가'], '가': ['이', '가'],
  '은': ['은', '는'], '는': ['은', '는'],
  '을': ['을', '를'], '를': ['을', '를'],
  '과': ['과', '와'], '와': ['과', '와'],
  '아': ['아', '야'], '야': ['아', '야'],
  '이랑': ['이랑', '랑'], '랑': ['이랑', '랑'],
};

export function hasBatchim(word) {
  if (!word) return false;
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return false;
  return (c - 0xac00) % 28 !== 0;
}

export function josa(word, p) {
  const pair = PAIRS[p];
  if (!pair) return word + p;
  return word + (hasBatchim(word) ? pair[0] : pair[1]);
}

// {이름} 이름만, {성} 성만, {성이름} 성과 이름, {직업} 전설 직업, 뒤에 :조사
export function fmt(text, who) {
  if (!text) return '';
  // 실수로 조사를 고정해서 쓴 경우({이름}은)도 자동으로 고친다
  text = text.replace(/\{(이름|성이름|성)\}(은|는|이|가|을|를|과|와|아|야)(?![가-힣])/g, '{$1:$2}');
  return text.replace(/\{(이름|성이름|성|직업)(?::([^}]+))?\}/g, (m, key, p) => {
    const w = key === '이름' ? who.given : key === '성' ? who.family : key === '직업' ? (who.job || '') : who.family + who.given;
    return p ? josa(w, p) : w;
  });
}

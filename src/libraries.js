// 화성시립도서관 지점 코드 매핑.
// MI = 목동이음터. 코드는 카탈로그 소장정보 테이블의 <tr class="XX"> 값.
export const TARGET_LIBRARY = 'MI';

export const LIBRARIES = {
  MI: { name: '목동이음터', short: '목동이음터', small: false },
  MK: { name: '화성동탄중앙도서관', short: '화성동탄중앙', small: false },
  MA: { name: '남양도서관', short: '남양', small: false },
  MB: { name: '태안도서관', short: '태안', small: false },
  MC: { name: '삼괴도서관', short: '삼괴', small: false },
  MD: { name: '병점도서관', short: '병점', small: false },
  MG: { name: '봉담도서관', short: '봉담', small: false },
  ML: { name: '송산도서관', short: '송산', small: false },
  MM: { name: '정남도서관', short: '정남', small: false },
  MO: { name: '진안도서관', short: '진안', small: false },
  MW: { name: '왕배푸른숲도서관', short: '왕배푸른숲', small: false },
  MX: { name: '노을빛도서관', short: '노을빛', small: false },
  NA: { name: '향남복합문화도서관', short: '향남복합', small: false },
  NB: { name: '봉담와우도서관', short: '봉담와우', small: false },
  MP: { name: '중앙이음터', short: '중앙이음터', small: false },
  MR: { name: '다원이음터', short: '다원이음터', small: false },
  MS: { name: '송린이음터', short: '송린이음터', small: false },
  MF: { name: '두빛나래', short: '두빛나래', small: false },
  MY: { name: '서연이음터', short: '서연이음터', small: false },
  MH: { name: '둥지나래', short: '둥지나래', small: false },
  TB: { name: '달빛나래', short: '달빛나래', small: false },
  ME: { name: '샘내', short: '샘내', small: false },
  MJ: { name: '기아행복마루', short: '기아행복마루', small: false },
  MN: { name: '비봉도서관', short: '비봉', small: false },
  MU: { name: '마도도서관', short: '마도', small: false },
  MT: { name: '팔탄도서관', short: '팔탄', small: false },
  MQ: { name: '양감도서관', short: '양감', small: false },
  MV: { name: '봉담커피앤북', short: '봉담커피앤북', small: false },
  TA: { name: '늘봄이음터', short: '늘봄이음터', small: false },
  MZ: { name: '호연이음터', short: '호연이음터', small: false },
  TC: { name: '서신도서관', short: '서신', small: false },
  TD: { name: '가족만세센터', short: '가족만세', small: false },
};

// 작은도서관으로 분류할 코드. 카탈로그에 작은도서관이 섞여 나오는 경우가 있어
// 사용자가 "작은도서관 제외"를 선택했을 때 걸러내기 위한 목록.
const SMALL_LIBRARY_CODES = new Set(['MU', 'MT', 'MQ', 'MV', 'TA', 'MZ', 'TC', 'TD']);
for (const code of SMALL_LIBRARY_CODES) {
  if (LIBRARIES[code]) LIBRARIES[code].small = true;
}

export function getLibrary(code) {
  const found = LIBRARIES[code];
  if (found) return found;
  return { name: code || '알 수 없음', short: code || '?', small: false };
}

export function isSmallLibrary(code) {
  return getLibrary(code).small;
}

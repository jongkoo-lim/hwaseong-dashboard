import { getLibrary, TARGET_LIBRARY } from './libraries.js';

export { TARGET_LIBRARY };

export const SITE = {
  origin: 'https://www.hscitylib.or.kr',
  searchPath: '/intro/menu/10008/program/30001/searchResultList.do',
  collectionPath: '/search/include/collectionBookList.do',
};

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DEFAULT_DISPLAY = 100;
const CACHE_TTL = 10 * 60 * 1000;
const CACHE_MAX = 1500;

const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  // LRU: 최근 사용으로 올린다.
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { at: Date.now(), value });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

export function clearCache() {
  cache.clear();
}

/* ------------------------------------------------------------------ */
/* 공통 유틸                                                           */
/* ------------------------------------------------------------------ */

const HTML_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  middot: '·',
  hellip: '…',
  ndash: '–',
  mdash: '—',
};

function decodeHtml(value) {
  return String(value ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const hex = code[1]?.toLowerCase() === 'x';
      const number = Number.parseInt(hex ? code.slice(2) : code.slice(1), hex ? 16 : 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : match;
    }
    return HTML_ENTITIES[code.toLowerCase()] ?? match;
  });
}

function cleanText(value) {
  return decodeHtml(String(value ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function nfc(value) {
  return String(value ?? '').normalize('NFC');
}

function parseCount(value) {
  const n = Number.parseInt(String(value ?? '').replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeIsbn(raw) {
  let s = String(raw ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
  if (s.length === 10) {
    const core = `978${s.slice(0, 9)}`;
    let sum = 0;
    for (let i = 0; i < 12; i += 1) {
      sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
    }
    s = core + String((10 - (sum % 10)) % 10);
  }
  return s;
}

function normalizeForMatch(value) {
  return nfc(value)
    .toLowerCase()
    .replace(/[\s\-_.,:;·'"“”‘’[\](){}<>]/g, '');
}

export function matchesTitle(title, query) {
  const t = normalizeForMatch(title);
  const q = normalizeForMatch(query);
  if (!q) return false;
  if (t.includes(q)) return true;
  const tokens = nfc(query).toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => t.includes(normalizeForMatch(token)));
}

function extractVolume(title) {
  const s = nfc(title);
  const found = [];
  const patterns = [
    /\.\s*(\d{1,3})(?=\s|$|:|\[)/g,
    /\[(\d{1,3})\]/g,
    /(?:^|\s)(\d{1,3})\s*$/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(s))) {
      found.push(Number.parseInt(match[1], 10));
    }
  }
  return found.length ? found[found.length - 1] : 1;
}

function mainTitle(title) {
  let t = nfc(title);
  t = t.replace(/\[[^\]]*]/g, ' ');
  t = t.split(':')[0];
  t = t.replace(/\.\s*\d{1,3}\s*$/, '');
  t = t.replace(/\s+\d{1,3}\s*$/, '');
  t = t.replace(/[\[\](){}.,;:'"·]/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function authorKey(author) {
  return nfc(author)
    .replace(/[\[\](){}]/g, ' ')
    .replace(/^(지은이|지음|글|저|엮은이|엮음|옮긴이|옮김)\s*:?\s*/, '')
    .replace(/\s*(지은이|지음|글|저|엮은이|엮음|옮긴이|옮김)\s*$/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();
}

export function displayAuthor(author) {
  const cleaned = nfc(author)
    .replace(/[\[\](){}]/g, ' ')
    .replace(/^(지은이|지음|글|저|엮은이|엮음|옮긴이|옮김)\s*:\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || '저자 미상';
}

function workKey(card) {
  return `${mainTitle(card.title).toLowerCase()}|${extractVolume(card.title)}|${authorKey(card.author)}`;
}

export function mapLimit(items, limit, worker) {
  const list = [...items];
  const results = new Array(list.length);
  let next = 0;
  let active = 0;

  return new Promise((resolve, reject) => {
    if (list.length === 0) {
      resolve(results);
      return;
    }

    const launch = () => {
      while (active < limit && next < list.length) {
        const index = next;
        next += 1;
        active += 1;
        Promise.resolve()
          .then(() => worker(list[index], index))
          .then((value) => {
            results[index] = value;
            active -= 1;
            if (next >= list.length && active === 0) resolve(results);
            else launch();
          })
          .catch(reject);
      }
    };

    launch();
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

function buildSearchUrl(query, page = 1, display = DEFAULT_DISPLAY) {
  const params = new URLSearchParams({
    searchType: 'SIMPLE',
    viewType: 'LIST',
    searchKeyword: query,
    searchManageCode: 'ALL',
    searchPubFormCode: 'MO',
    currentPageNo: String(page),
    searchDisplay: String(display),
    searchArticle: 'SCORE',
    searchOrder: 'ASC',
    reSearchYn: 'N',
    preSearchKeyword: query,
  });
  return `${SITE.origin}${SITE.searchPath}?${params.toString()}`;
}

async function fetchHtml(url, { method = 'GET', body, referer, timeout = 20_000, retries = 2, cacheKey, fresh = false } = {}) {
  if (cacheKey && !fresh) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        method,
        body,
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          ...(referer ? { referer } : {}),
          ...(method === 'POST'
            ? { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' }
            : {}),
        },
      });

      if (!response.ok) {
        const error = new Error(`도서관 사이트 응답 오류 (HTTP ${response.status})`);
        error.status = response.status;
        throw error;
      }

      const html = await response.text();
      if (cacheKey) cacheSet(cacheKey, html);
      return html;
    } catch (error) {
      lastError = error;
      const status = error?.status;
      const retryable = !status || status === 429 || status >= 500;
      if (!retryable || attempt >= retries) break;
      await delay(500 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }

  if (lastError?.name === 'AbortError') {
    throw new Error('도서관 사이트 응답이 너무 느립니다. 잠시 후 다시 시도해 주세요.');
  }
  throw lastError ?? new Error('도서관 사이트에 연결하지 못했습니다.');
}

/* ------------------------------------------------------------------ */
/* 검색 결과 파싱                                                       */
/* ------------------------------------------------------------------ */

function parseCard(chunk) {
  const detail = chunk.match(
    /fnDetail\(\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/,
  );
  if (!detail) return null;

  const [, bookKey, speciesKey, isbnRaw, pubFormCode] = detail;

  let title = '';
  const titleMatch = chunk.match(/<p class="book_name kor on">[\s\S]*?title="([^"]*)"/);
  if (titleMatch) title = cleanText(titleMatch[1]);
  if (!title) {
    const highlighted = chunk.match(/<span class='highlight word'>([\s\S]*?)<\/span>/);
    if (highlighted) title = cleanText(highlighted[1]);
  }
  if (!title) return null;

  const infoMatch = chunk.match(/<li class="kor on">([\s\S]*?)<\/li>/);
  const info = infoMatch
    ? [...infoMatch[1].matchAll(/<span>([\s\S]*?)<\/span>/g)].map((m) => cleanText(m[1]))
    : [];
  const author = info[0] ?? '';
  const publisher = info[1] ?? '';
  const year = info[2] ?? '';

  const callMatch = chunk.match(
    /<li><span>([\s\S]*?)<\/span>\s*<a href="#pop"[^>]*fnCallNoPrintPop/,
  );
  const callNumber = callMatch ? cleanText(callMatch[1]) : '';

  const locationMatch = chunk.match(
    /<li><span><b class="themeFC">\[([^\]]*)]<\/b>\s*([\s\S]*?)<\/span><\/li>/,
  );
  const cardLibrary = locationMatch ? cleanText(locationMatch[1]) : '';
  const cardLocation = locationMatch ? cleanText(locationMatch[2]) : '';

  const statusMatch = chunk.match(/<span class="emp1">([\s\S]*?)<\/span>/);
  const cardStatus = statusMatch ? cleanText(statusMatch[1]) : '비치중';

  const coverMatch = chunk.match(/<div class="bookImg">[\s\S]*?<img[^>]*src="([^"]*)"/);
  const cover = coverMatch ? decodeHtml(coverMatch[1]) : '';

  const kindMatch = chunk.match(/<b class="book_kind">([\s\S]*?)<\/b>/);
  const kind = kindMatch ? cleanText(kindMatch[1]) : '';

  return {
    bookKey,
    speciesKey,
    isbn: normalizeIsbn(isbnRaw),
    pubFormCode: pubFormCode || 'MO',
    title,
    author,
    publisher,
    year,
    callNumber,
    cardLibrary,
    cardLocation,
    cardStatus,
    cover,
    kind,
    detailUrl: buildDetailUrl(bookKey, speciesKey, isbnRaw, pubFormCode || 'MO'),
  };
}

export function buildDetailUrl(bookKey, speciesKey, isbn, pubFormCode = 'MO') {
  const params = new URLSearchParams({
    bookKey: bookKey ?? '',
    speciesKey: speciesKey ?? '',
    isbn: isbn ?? '',
    searchPubFormCode: pubFormCode ?? 'MO',
  });
  return `${SITE.origin}/intro/menu/10008/program/30001/bookDetail.do?${params.toString()}`;
}

export function parseSearchPage(html, query, mode = 'title') {
  const totalMatch = html.match(/id=["']totalCnt["'][^>]*>([\d,]+)/);
  const total = totalMatch ? parseCount(totalMatch[1]) : 0;

  const chunks = html.split(/<div[^>]*class="[^"]*bookArea[^"]*"[^>]*>/).slice(1);
  const rawCards = [];
  for (const chunk of chunks) {
    const card = parseCard(chunk);
    if (card) rawCards.push(card);
  }

  const cards =
    mode === 'all' ? rawCards : rawCards.filter((card) => matchesTitle(card.title, query));

  return { total, rawCards, cards };
}

/* ------------------------------------------------------------------ */
/* 작품(제목+권+저자) 단위 그룹화                                        */
/* ------------------------------------------------------------------ */

function addCardToWork(works, card, query) {
  const key = workKey(card);
  let work = works.get(key);
  if (!work) {
    work = {
      key,
      mainTitle: mainTitle(card.title),
      volume: extractVolume(card.title),
      editions: new Map(),
      queries: new Set(),
      titles: new Set(),
    };
    works.set(key, work);
  }

  work.queries.add(query);
  work.titles.add(card.title);

  const editionKey = card.isbn || card.speciesKey || card.bookKey || key;
  let edition = work.editions.get(editionKey);
  if (!edition) {
    edition = {
      isbn: card.isbn,
      speciesKey: card.speciesKey,
      bookKey: card.bookKey,
      title: card.title,
      count: 0,
      card,
    };
    work.editions.set(editionKey, edition);
  }
  edition.count += 1;
  if (!edition.isbn && card.isbn) edition.isbn = card.isbn;
  if (!edition.speciesKey && card.speciesKey) edition.speciesKey = card.speciesKey;
  // 대표 카드가 더 완전한 정보를 가질 수 있으므로 표지/상세 URL은 갱신한다.
  if (card.cover) edition.card.cover = card.cover;
  if (card.detailUrl) edition.card.detailUrl = card.detailUrl;
}

export function finalizeWork(work) {
  const editions = [...work.editions.values()]
    .sort((a, b) => b.count - a.count)
    .map((edition) => ({
      isbn: edition.isbn,
      speciesKey: edition.speciesKey,
      bookKey: edition.bookKey,
      title: edition.title,
      count: edition.count,
    }));

  const topEdition = [...work.editions.values()].sort((a, b) => b.count - a.count)[0];
  const card = topEdition.card;

  const displayTitle =
    work.volume > 1 ? `${work.mainTitle || card.title} ${work.volume}` : work.mainTitle || card.title;

  const isbns = [...new Set(editions.map((edition) => edition.isbn).filter(Boolean))];

  return {
    key: work.key,
    title: displayTitle,
    fullTitle: card.title,
    mainTitle: work.mainTitle,
    volume: work.volume,
    author: displayAuthor(card.author),
    publisher: card.publisher || '',
    year: card.year || '',
    isbn: card.isbn || isbns[0] || '',
    isbns,
    cover: card.cover || '',
    detailUrl: card.detailUrl || '',
    kind: card.kind || '',
    queries: [...work.queries],
    editions,
    editionsTotal: editions.length,
    editionsFetched: 0,
    editionErrors: [],
    holdings: [],
    holdingsTotal: 0,
    fetchedAt: null,
    error: null,
  };
}

/* ------------------------------------------------------------------ */
/* 검색어 하나 조회                                                     */
/* ------------------------------------------------------------------ */

export async function searchQuery(query, options = {}) {
  const {
    limit = 100,
    maxPages = 20,
    display = DEFAULT_DISPLAY,
    mode = 'title',
    fresh = false,
  } = options;

  const works = new Map();
  let page = 1;
  let siteTotal = 0;
  let rawCards = 0;
  let matchedCards = 0;
  let lastPageCards = 0;
  let noMatchPages = 0;
  let exhausted = false;

  while (page <= maxPages) {
    const html = await fetchHtml(buildSearchUrl(query, page, display), {
      referer: SITE.origin,
      cacheKey: `search:${mode}:${display}:${query}:${page}`,
      fresh,
    });

    if (!html.includes('totalCnt') && !html.includes('bookArea')) {
      throw new Error(
        '도서관 검색 페이지 구조를 해석하지 못했습니다. 사이트가 변경되었거나 일시적으로 접근이 제한되었을 수 있습니다.',
      );
    }

    const parsed = parseSearchPage(html, query, mode);
    if (page === 1) siteTotal = parsed.total;
    rawCards += parsed.rawCards.length;
    matchedCards += parsed.cards.length;
    lastPageCards = parsed.rawCards.length;

    for (const card of parsed.cards) addCardToWork(works, card, query);

    if (mode === 'title' && parsed.cards.length === 0 && parsed.rawCards.length > 0) {
      noMatchPages += 1;
    } else {
      noMatchPages = 0;
    }

    const reachedLimit = works.size >= limit;
    const siteExhausted = siteTotal > 0 && page * display >= siteTotal;
    const shortPage = parsed.rawCards.length < display;
    exhausted =
      parsed.rawCards.length === 0 ||
      siteExhausted ||
      shortPage ||
      noMatchPages >= 3;

    if (reachedLimit || exhausted) break;
    page += 1;
  }

  const allWorks = [...works.values()];
  const limited = allWorks.slice(0, limit);
  const capped = allWorks.length > limit || !exhausted;

  return {
    query,
    siteTotal,
    rawCards,
    matchedCards,
    works: limited.map(finalizeWork),
    worksFound: limited.length,
    totalWorksFound: allWorks.length,
    pages: page,
    capped,
  };
}

/* ------------------------------------------------------------------ */
/* 소장 정보 파싱                                                       */
/* ------------------------------------------------------------------ */

const AVAILABLE_RE = /비치중|대출가능|이용가능/;
const UNAVAILABLE_RE = /대출중|상호대차중|예약중|정리중|분실|폐기|파손|제적|대출불가|이용불가|비치아님/;

export function isAvailableStatus(status) {
  const s = String(status ?? '');
  if (!s) return false;
  if (UNAVAILABLE_RE.test(s)) return false;
  return AVAILABLE_RE.test(s);
}

export function classifyFormat(callNumber, location) {
  const text = `${callNumber ?? ''} ${location ?? ''}`;
  if (/점자/.test(text)) return 'braille';
  if (/큰글|큰글자/.test(text)) return 'large';
  return 'regular';
}

function parseReservations(status) {
  const match = String(status ?? '').match(/예약\s*:?\s*(\d+)\s*명/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

export function parseHoldings(html) {
  const rows = [];
  const rowRe = /<tr[^>]*class=['"]([A-Z]{2})['"][^>]*>([\s\S]*?)<\/tr>/g;
  let match;
  while ((match = rowRe.exec(html))) {
    const code = match[1];
    const block = match[2];
    const cells = [...block.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => cleanText(m[1]));
    if (cells.length < 3) continue;

    const [rawLocation, callNumber, status, dueDate = '', serviceCell = ''] = cells;
    const services = [
      ...new Set(
        [...block.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/g)]
          .map((m) => cleanText(m[1]))
          .filter(Boolean),
      ),
    ];
    const serviceText = cleanText(serviceCell);
    const blockedServices = [...serviceText.matchAll(/([가-힣]+)\s*불가/g)].map((m) => m[1]);

    const lib = getLibrary(code);
    const location = rawLocation.replace(/^\[[^\]]*]\s*/, '').trim();
    const format = classifyFormat(callNumber, location);
    const available = isAvailableStatus(status);
    const due = dueDate && dueDate !== '-' ? dueDate : null;

    rows.push({
      lib: code,
      libName: lib.name,
      shortName: lib.short,
      small: lib.small,
      location,
      rawLocation,
      callNumber,
      status: status || (available ? '비치중' : ''),
      available,
      dueDate: due,
      reservations: parseReservations(status),
      services,
      blockedServices,
      format,
      // 상호대차 가능 여부는 "비치중 + 상호대차 서비스" 조합으로 판단한다.
      mutualLoan: available && services.includes('상호대차'),
      reservation: !available && services.includes('대출예약'),
    });
  }
  return rows;
}

export async function fetchHoldings(speciesKey, options = {}) {
  if (!speciesKey) return [];
  const { fresh = false } = options;
  const html = await fetchHtml(`${SITE.origin}${SITE.collectionPath}`, {
    method: 'POST',
    body: new URLSearchParams({ speciesKey }).toString(),
    referer: `${SITE.origin}${SITE.searchPath}`,
    cacheKey: `holdings:${speciesKey}`,
    fresh,
    retries: 2,
    timeout: 25_000,
  });
  return parseHoldings(html);
}

function dedupeHoldings(rows) {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    const key = [
      row.lib,
      row.callNumber,
      row.location,
      row.status,
      row.dueDate ?? '',
      row.format,
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

function callNumberSortKey(callNumber) {
  const raw = String(callNumber ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const match = raw.match(/(\d+)(?:\.(\d+))?/);
  if (!match) return `\uffff${raw}`;

  const integer = match[1].padStart(8, '0');
  const fraction =
    match[2] === undefined
      ? '000000'
      : Math.round(Number(`0.${match[2]}`) * 1e6)
          .toString()
          .padStart(6, '0');
  const prefix = raw.slice(0, match.index).trim();
  return `${integer}.${fraction}|${collectionRank(prefix)}|${prefix}|${raw}`;
}

function collectionRank(prefix) {
  const ranks = {
    '': '0',
    아: '1',
    유: '2',
    전: '3',
    전집: '3',
    큰: '4',
    큰글: '4',
    큰글자: '4',
    점자: '5',
  };
  return ranks[prefix] ?? `9-${prefix}`;
}

export function sortHoldings(rows) {
  return [...rows].sort((a, b) => {
    if (a.lib === TARGET_LIBRARY && b.lib !== TARGET_LIBRARY) return -1;
    if (b.lib === TARGET_LIBRARY && a.lib !== TARGET_LIBRARY) return 1;
    if (a.available !== b.available) return a.available ? -1 : 1;
    if (a.small !== b.small) return a.small ? 1 : -1;
    if (a.libName !== b.libName) return a.libName.localeCompare(b.libName, 'ko');
    return callNumberSortKey(a.callNumber).localeCompare(callNumberSortKey(b.callNumber));
  });
}

export async function fetchWorkHoldings(work, options = {}) {
  const { fresh = false, maxEditions = 10 } = options;
  const editions = work.editions
    .filter((edition) => edition.speciesKey)
    .slice(0, maxEditions);

  if (editions.length === 0) {
    return {
      holdings: [],
      editionsFetched: 0,
      editionErrors: [],
      error: '소장 정보를 조회할 판본 정보가 없습니다.',
    };
  }

  const errors = [];
  const results = await mapLimit(editions, 2, async (edition) => {
    try {
      const rows = await fetchHoldings(edition.speciesKey, { fresh });
      return rows.map((row) => ({ ...row, editionIsbn: edition.isbn }));
    } catch (error) {
      errors.push({
        isbn: edition.isbn,
        speciesKey: edition.speciesKey,
        message: error?.message ?? String(error),
      });
      return [];
    }
  });

  const holdings = sortHoldings(dedupeHoldings(results.flat()));
  return {
    holdings,
    editionsFetched: editions.length,
    editionErrors: errors,
    error:
      holdings.length === 0 && errors.length > 0
        ? '소장 정보를 불러오지 못했습니다.'
        : null,
  };
}

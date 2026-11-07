import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SITE,
  TARGET_LIBRARY,
  fetchWorkHoldings,
  mapLimit,
  searchQuery,
} from './src/catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '127.0.0.1';

const MAX_QUERIES = 30;
const MAX_QUERY_LENGTH = 120;
const MAX_BODY_BYTES = 1_000_000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('요청 본문이 너무 큽니다.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('요청 본문이 올바른 JSON이 아닙니다.');
    error.status = 400;
    throw error;
  }
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeQueries(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const result = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const query = raw.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
    if (!query) continue;
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(query);
    if (result.length >= MAX_QUERIES) break;
  }
  return result;
}

function mergeWorkInto(found, work) {
  const existing = found.get(work.key);
  if (!existing) {
    found.set(work.key, work);
    return;
  }

  for (const query of work.queries) {
    if (!existing.queries.includes(query)) existing.queries.push(query);
  }

  const editionKeys = new Set(
    existing.editions.map((edition) => edition.isbn || edition.speciesKey),
  );
  for (const edition of work.editions) {
    const key = edition.isbn || edition.speciesKey;
    if (!editionKeys.has(key)) {
      existing.editions.push(edition);
      editionKeys.add(key);
    }
  }
  existing.editionsTotal = existing.editions.length;
  existing.isbns = [...new Set(existing.editions.map((edition) => edition.isbn).filter(Boolean))];

  // 대표 표지가 비어 있으면 다른 검색어 결과에서 보충한다.
  if (!existing.cover && work.cover) existing.cover = work.cover;
  if (!existing.detailUrl && work.detailUrl) existing.detailUrl = work.detailUrl;
}

async function handleSearch(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, error.status ?? 400, { error: error.message });
    return;
  }

  const queries = normalizeQueries(body.queries);
  if (queries.length === 0) {
    sendJson(res, 400, { error: '검색할 책 제목을 한 개 이상 입력해 주세요.' });
    return;
  }

  const limitPerQuery = clampInt(body.limitPerQuery, 20, 300, 100);
  const maxTotalWorks = clampInt(body.maxTotalWorks, 20, 600, 300);
  const maxPages = clampInt(body.maxPages, 1, 30, 20);
  const maxEditions = clampInt(body.maxEditions, 1, 20, 10);
  const mode = body.mode === 'all' ? 'all' : 'title';
  const fresh = body.fresh === true;

  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store, no-cache, must-revalidate',
    'x-accel-buffering': 'no',
    connection: 'keep-alive',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let aborted = false;
  res.on('close', () => {
    if (!res.writableEnded) aborted = true;
  });

  const writeEvent = (event) => {
    if (aborted || res.writableEnded) return false;
    try {
      res.write(`${JSON.stringify(event)}\n`);
      return true;
    } catch {
      aborted = true;
      return false;
    }
  };

  const startedAt = Date.now();
  const warnings = [];
  const found = new Map();
  const queryStats = [];
  const queryErrors = [];

  writeEvent({
    type: 'start',
    queries,
    options: { limitPerQuery, maxTotalWorks, maxPages, maxEditions, mode },
    startedAt: new Date(startedAt).toISOString(),
  });

  try {
    for (let index = 0; index < queries.length; index += 1) {
      if (aborted) break;
      const query = queries[index];
      writeEvent({ type: 'query-start', query, index, total: queries.length });

      try {
        const result = await searchQuery(query, {
          limit: limitPerQuery,
          maxPages,
          mode,
          fresh,
        });

        for (const work of result.works) mergeWorkInto(found, work);

        const stat = {
          query: result.query,
          siteTotal: result.siteTotal,
          rawCards: result.rawCards,
          matchedCards: result.matchedCards,
          worksFound: result.worksFound,
          totalWorksFound: result.totalWorksFound,
          pages: result.pages,
          capped: result.capped,
        };
        queryStats.push(stat);
        writeEvent({ type: 'query', ...stat });

        if (result.capped) {
          warnings.push(
            `"${query}" 결과가 많아 ${result.worksFound}권까지만 가져왔습니다. 더 많은 결과가 있을 수 있습니다.`,
          );
        }
        if (result.siteTotal > 0 && result.matchedCards === 0 && mode === 'title') {
          warnings.push(`"${query}"는 제목에 검색어가 포함된 자료를 찾지 못했습니다.`);
        }
      } catch (error) {
        const message = error?.message ?? String(error);
        queryErrors.push({ query, message });
        queryStats.push({ query, error: message, siteTotal: 0, worksFound: 0 });
        writeEvent({ type: 'query', query, error: message, siteTotal: 0, worksFound: 0 });
        warnings.push(`"${query}" 조회 실패: ${message}`);
      }
    }

    if (!aborted && found.size === 0 && queryErrors.length === queries.length) {
      writeEvent({
        type: 'error',
        message:
          '모든 검색어 조회에 실패했습니다. 도서관 사이트 연결 상태를 확인한 뒤 다시 시도해 주세요.',
      });
      res.end();
      return;
    }

    const allWorks = [...found.values()];
    if (allWorks.length > maxTotalWorks) {
      warnings.push(
        `전체 결과가 ${allWorks.length}권이라 상한 ${maxTotalWorks}권까지만 표시합니다. 검색어를 더 구체적으로 입력해 주세요.`,
      );
      allWorks.length = maxTotalWorks;
    }

    writeEvent({
      type: 'plan',
      totalWorks: allWorks.length,
      queryStats,
      warnings,
      targetLibrary: TARGET_LIBRARY,
    });

    let done = 0;
    await mapLimit(allWorks, 4, async (work) => {
      if (aborted) return;
      try {
        const result = await fetchWorkHoldings(work, { fresh, maxEditions });
        work.holdings = result.holdings;
        work.holdingsTotal = result.holdings.length;
        work.editionsFetched = result.editionsFetched;
        work.editionErrors = result.editionErrors;
        work.error = result.error;
        work.fetchedAt = new Date().toISOString();

        if (result.editionErrors.length > 0) {
          const failedIsbns = result.editionErrors
            .map((error) => error.isbn || error.speciesKey)
            .filter(Boolean)
            .join(', ');
          if (failedIsbns) {
            work.partial = true;
            work.partialNote = `일부 판본(${failedIsbns})의 소장 정보를 불러오지 못했습니다.`;
          }
        }
      } catch (error) {
        work.error = error?.message ?? String(error);
        work.holdings = [];
        work.holdingsTotal = 0;
        work.fetchedAt = new Date().toISOString();
      }

      done += 1;
      writeEvent({ type: 'book', book: work });
      writeEvent({ type: 'progress', phase: 'holdings', done, total: allWorks.length });
    });

    writeEvent({
      type: 'done',
      totalBooks: allWorks.length,
      elapsedMs: Date.now() - startedAt,
      warnings,
      aborted,
    });
  } catch (error) {
    writeEvent({
      type: 'error',
      message: error?.message ?? '조회 중 알 수 없는 오류가 발생했습니다.',
    });
  } finally {
    if (!res.writableEnded) res.end();
  }
}

function serveStatic(req, res, pathname) {
  let relative = pathname === '/' ? '/index.html' : pathname;
  try {
    relative = decodeURIComponent(relative);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('잘못된 경로입니다.');
    return;
  }

  const filePath = path.normalize(path.join(PUBLIC_DIR, relative));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('접근할 수 없습니다.');
    return;
  }

  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('파일을 찾을 수 없습니다.');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const isHtml = ext === '.html';
    res.writeHead(200, {
      'content-type': MIME_TYPES[ext] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
      'content-length': stat.size,
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${HOST}:${PORT}`}`);
  const pathname = url.pathname;

  try {
    if (pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        targetLibrary: TARGET_LIBRARY,
        site: SITE.origin,
        now: new Date().toISOString(),
      });
      return;
    }

    if (pathname === '/api/search') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'POST 요청만 지원합니다.' });
        return;
      }
      await handleSearch(req, res);
      return;
    }

    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: '없는 API입니다.' });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('GET 요청만 지원합니다.');
      return;
    }

    serveStatic(req, res, pathname);
  } catch (error) {
    if (!res.headersSent) {
      sendJson(res, 500, { error: error?.message ?? '서버 오류가 발생했습니다.' });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n포트 ${PORT}가 이미 사용 중입니다.`);
    console.error(`다른 포트로 실행하려면: PORT=3001 node server.js\n`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  화성시립도서관 · 목동이음터 대시보드');
  console.log(`  http://${HOST}:${PORT}`);
  console.log('  종료: Ctrl+C');
  console.log('');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

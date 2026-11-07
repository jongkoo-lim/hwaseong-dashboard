'use strict';

const TARGET_LIBRARY = 'MI';
const STORAGE_KEY = 'hwaseong-mokdong-dashboard-v1';
const CUSTOM_COVER_STORAGE_KEY = 'hwaseong-mokdong-custom-covers-v1';
const MAX_QUERIES = 30;
const MAX_COVER_FILE_BYTES = 10 * 1024 * 1024;
const MAX_COVER_DIMENSION = 640;

const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
const numberFormat = new Intl.NumberFormat('ko-KR');
const timeFormat = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' });

const STATUS_META = {
  green: {
    icon: '🟢',
    label: '목동 비치중',
    short: '목동 비치',
    description: '목동이음터에서 바로 대출 가능',
  },
  yellow: {
    icon: '🟡',
    label: '대출중 · 타관 가능',
    short: '대출중·타관',
    description: '목동은 대출중, 다른 도서관은 비치',
  },
  blue: {
    icon: '🔵',
    label: '타관에만 있음',
    short: '타관만',
    description: '목동 미소장, 다른 도서관은 비치',
  },
  red: {
    icon: '🔴',
    label: '전체 미소장/불가',
    short: '대출불가',
    description: '관내 미소장 또는 모두 대출 불가',
  },
};

const $ = (id) => document.getElementById(id);

const els = {
  form: $('searchForm'),
  queryInput: $('queryInput'),
  queryCount: $('queryCount'),
  searchBtn: $('searchBtn'),
  cancelBtn: $('cancelBtn'),
  resetBtn: $('resetBtn'),
  limitPerQuery: $('limitPerQuery'),
  maxTotalWorks: $('maxTotalWorks'),
  includeSpecial: $('includeSpecial'),
  includeSmall: $('includeSmall'),
  errorBanner: $('errorBanner'),
  progressPanel: $('progressPanel'),
  progressLabel: $('progressLabel'),
  progressPercent: $('progressPercent'),
  progressBar: $('progressBar'),
  progressDetail: $('progressDetail'),
  emptyLanding: $('emptyLanding'),
  summarySection: $('summarySection'),
  summaryMeta: $('summaryMeta'),
  summaryExtra: $('summaryExtra'),
  statGrid: $('statGrid'),
  warningList: $('warningList'),
  refreshBtn: $('refreshBtn'),
  csvBtn: $('csvBtn'),
  resultsSection: $('resultsSection'),
  statusTabs: $('statusTabs'),
  queryFilter: $('queryFilter'),
  resultMeta: $('resultMeta'),
  bookList: $('bookList'),
  emptyState: $('emptyState'),
  toast: $('toast'),
  coverEditor: $('coverEditor'),
  coverEditorBook: $('coverEditorBook'),
  coverEditorPreview: $('coverEditorPreview'),
  coverEditorEmpty: $('coverEditorEmpty'),
  coverFileInput: $('coverFileInput'),
  coverDropBox: $('coverDropBox'),
  coverUrlInput: $('coverUrlInput'),
  coverUrlApply: $('coverUrlApply'),
  coverSaveBtn: $('coverSaveBtn'),
  coverRemoveBtn: $('coverRemoveBtn'),
  photoInput: $('photoInput'),
  photoDropBox: $('photoDropBox'),
  photoPickBtn: $('photoPickBtn'),
  photoPreviewBox: $('photoPreviewBox'),
  photoPreviewImg: $('photoPreviewImg'),
  photoMeta: $('photoMeta'),
  photoChangeBtn: $('photoChangeBtn'),
  photoRemoveBtn: $('photoRemoveBtn'),
  ocrRawBox: $('ocrRawBox'),
  ocrRawText: $('ocrRawText'),
  ocrRawApply: $('ocrRawApply'),
  ocrAddInput: $('ocrAddInput'),
  ocrAddTitleBtn: $('ocrAddTitleBtn'),
  ocrStatus: $('ocrStatus'),
  ocrResults: $('ocrResults'),
  ocrCount: $('ocrCount'),
  ocrList: $('ocrList'),
  ocrAddBtn: $('ocrAddBtn'),
  ocrSearchBtn: $('ocrSearchBtn'),
};

const state = {
  searchId: 0,
  queries: [],
  books: new Map(),
  entriesByKey: new Map(),
  queryStats: [],
  warnings: [],
  filter: 'all',
  sort: 'call',
  queryFilter: null,
  mode: 'title',
  limitPerQuery: 50,
  maxTotalWorks: 100,
  includeSpecial: true,
  includeSmall: true,
  isSearching: false,
  planReceived: false,
  finishRequested: false,
  cancelled: false,
  done: false,
  error: null,
  customCovers: new Map(),
  coverEditorBookKey: null,
  coverEditorDraft: null,
  ocrItems: [],
  totalWorks: 0,
  doneCount: 0,
  startedAt: 0,
  finishedAt: null,
  elapsedMs: 0,
  controller: null,
  renderTimer: null,
  progressHideTimer: null,
  toastTimer: null,
};

/* ------------------------------------------------------------------ */
/* 시작                                                                */
/* ------------------------------------------------------------------ */

init();

function init() {
  loadPrefs();
  loadCustomCovers();
  bindEvents();
  updateQueryCount();
  renderAll();
}

function bindEvents() {
  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    startSearch();
  });

  els.queryInput.addEventListener('input', () => {
    updateQueryCount();
    savePrefs();
  });

  els.queryInput.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      startSearch();
    }
  });

  document.querySelectorAll('.example').forEach((button) => {
    button.addEventListener('click', () => addExample(button.dataset.example));
  });

  els.cancelBtn.addEventListener('click', cancelSearch);
  els.resetBtn.addEventListener('click', resetAll);
  els.refreshBtn.addEventListener('click', () => {
    startSearch({ fresh: true, queriesOverride: [...state.queries] });
  });
  els.csvBtn.addEventListener('click', exportCsv);

  [els.limitPerQuery, els.maxTotalWorks, els.includeSpecial, els.includeSmall].forEach((element) => {
    element.addEventListener('change', () => {
      syncOptionsFromForm();
      savePrefs();
      renderAll();
    });
  });

  document.querySelectorAll('input[name="mode"]').forEach((element) => {
    element.addEventListener('change', () => {
      syncOptionsFromForm();
      savePrefs();
    });
  });

  els.statusTabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    const key = button.dataset.filter;
    state.filter = state.filter === key ? 'all' : key;
    renderAll();
  });

  els.statGrid.addEventListener('click', (event) => {
    const card = event.target.closest('[data-filter]');
    if (!card) return;
    const key = card.dataset.filter;
    state.filter = state.filter === key ? 'all' : key;
    renderAll();
    if (state.books.size > 0) {
      els.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  els.queryFilter.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-query]');
    if (!chip) return;
    const query = chip.dataset.query;
    state.queryFilter = state.queryFilter === query ? null : query;
    renderAll();
  });

  els.errorBanner.addEventListener('click', (event) => {
    if (event.target.closest('.banner-close')) hideError();
  });

  els.emptyState.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="reset-filter"]')) {
      state.filter = 'all';
      state.queryFilter = null;
      renderAll();
      return;
    }
    if (event.target.closest('[data-action="focus-input"]')) {
      els.queryInput.focus();
      els.queryInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  // <details> 내용은 펼칠 때만 렌더링해 결과가 많을 때의 DOM 부담을 줄인다.
  els.bookList.addEventListener(
    'toggle',
    (event) => {
      const details = event.target.closest('details.book-details');
      if (!details || !details.open) return;
      const inner = details.querySelector('.details-inner');
      if (!inner || inner.dataset.loaded === '1') return;
      const entry = state.entriesByKey.get(details.dataset.key);
      if (!entry) return;
      inner.innerHTML = renderDetailsInner(entry);
      inner.dataset.loaded = '1';
    },
    true,
  );

  els.bookList.addEventListener('click', (event) => {
    const coverButton = event.target.closest('[data-action="add-cover"]');
    if (!coverButton) return;
    openCoverEditor(coverButton.dataset.key);
  });

  els.coverEditor.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="close-cover-editor"]')) closeCoverEditor();
  });

  els.coverFileInput.addEventListener('change', async () => {
    const file = els.coverFileInput.files && els.coverFileInput.files[0];
    if (file) await setCoverDraftFromFile(file);
    els.coverFileInput.value = '';
  });

  els.coverDropBox.addEventListener('dragover', (event) => {
    event.preventDefault();
    els.coverDropBox.classList.add('dragging');
  });

  els.coverDropBox.addEventListener('dragleave', () => {
    els.coverDropBox.classList.remove('dragging');
  });

  els.coverDropBox.addEventListener('drop', async (event) => {
    event.preventDefault();
    els.coverDropBox.classList.remove('dragging');
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) await setCoverDraftFromFile(file);
  });

  els.coverUrlApply.addEventListener('click', () => {
    const url = safeUrl(els.coverUrlInput.value.trim());
    if (!url) {
      showToast('http 또는 https 이미지 주소만 사용할 수 있습니다.', 'warn');
      return;
    }
    setCoverDraft(url);
  });

  els.coverUrlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      els.coverUrlApply.click();
    }
  });

  els.coverSaveBtn.addEventListener('click', saveCoverDraft);

  els.coverRemoveBtn.addEventListener('click', () => {
    const bookKey = state.coverEditorBookKey;
    if (!bookKey) return;
    const book = state.books.get(bookKey);
    removeCustomCover(bookKey, book);
    closeCoverEditor();
    renderAll();
    showToast('직접 추가한 표지를 제거했습니다.');
  });

  els.photoInput.addEventListener('change', async () => {
    const file = els.photoInput.files && els.photoInput.files[0];
    if (file) await extractTitlesFromPhoto(file);
    els.photoInput.value = '';
  });

  // <label for="photoInput">이라 클릭/엔터는 브라우저가 파일 창을 바로 연다.
  // (JS로 input.click()를 또 부르면 파일 창이 두 번 뜰 수 있어 click 리스너는 두지 않는다.)
  els.photoDropBox.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      els.photoInput.click();
    }
  });

  els.photoChangeBtn.addEventListener('click', () => {
    els.photoInput.click();
  });

  els.photoRemoveBtn.addEventListener('click', () => {
    clearPhotoSelection();
  });

  els.photoDropBox.addEventListener('dragover', (event) => {
    event.preventDefault();
    els.photoDropBox.classList.add('dragging');
  });

  els.photoDropBox.addEventListener('dragleave', () => {
    els.photoDropBox.classList.remove('dragging');
  });

  els.photoDropBox.addEventListener('drop', async (event) => {
    event.preventDefault();
    els.photoDropBox.classList.remove('dragging');
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) await extractTitlesFromPhoto(file);
  });

  document.addEventListener('dragover', (event) => {
    if (event.dataTransfer && [...(event.dataTransfer.types || [])].includes('Files')) {
      event.preventDefault();
    }
  });

  document.addEventListener('drop', (event) => {
    event.preventDefault();
  });

  document.addEventListener('paste', async (event) => {
    const items = event.clipboardData && event.clipboardData.items ? [...event.clipboardData.items] : [];
    const imageItem = items.find((item) => item.type && item.type.startsWith('image/'));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (file) {
      event.preventDefault();
      await extractTitlesFromPhoto(file);
    }
  });

  els.ocrList.addEventListener('click', (event) => {
    const badge = event.target.closest('[data-ocr-badge-index]');
    if (!badge) return;
    const index = Number(badge.dataset.ocrBadgeIndex);
    cycleOcrSticker(index);
  });

  els.ocrList.addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-ocr-index]');
    if (!checkbox) return;
    const index = Number(checkbox.dataset.ocrIndex);
    if (state.ocrItems[index]) state.ocrItems[index].checked = checkbox.checked;
    els.ocrCount.textContent = `${state.ocrItems.filter((item) => item.checked).length}권 체크됨 / ${state.ocrItems.length}권`;
  });

  els.ocrAddTitleBtn.addEventListener('click', () => addOcrTitle());
  els.ocrAddInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addOcrTitle();
    }
  });

  els.ocrAddBtn.addEventListener('click', () => applyOcrTitles(false));
  els.ocrSearchBtn.addEventListener('click', () => applyOcrTitles(true));

  els.ocrRawApply.addEventListener('click', () => {
    const text = els.ocrRawText.value || '';
    const lines = text
      .split(/\r?\n/)
      .map((line) => extractTitleFromLine(line))
      .filter(Boolean);
    const unique = [...new Set(lines)];
    if (unique.length === 0) {
      showToast('원문에서 제목을 찾지 못했습니다.', 'warn');
      return;
    }
    state.ocrItems = unique.map((title) => ({ title, checked: true, bothRead: false, red: false, green: false }));
    renderOcrItems();
    applyOcrTitles(false);
    setOcrStatus(`원문으로 다시 ${unique.length}권을 뽑았습니다.`);
  });
}

/* ------------------------------------------------------------------ */
/* 설정                                                                */
/* ------------------------------------------------------------------ */

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return;

    if (typeof saved.queries === 'string') els.queryInput.value = saved.queries;
    if (saved.mode === 'all') setMode('all');
    if (['50', '100', '200', '300'].includes(String(saved.limitPerQuery))) {
      els.limitPerQuery.value = String(saved.limitPerQuery);
    }
    if (['100', '200', '300', '500'].includes(String(saved.maxTotalWorks))) {
      els.maxTotalWorks.value = String(saved.maxTotalWorks);
    }
    if (typeof saved.includeSpecial === 'boolean') els.includeSpecial.checked = saved.includeSpecial;
    if (typeof saved.includeSmall === 'boolean') els.includeSmall.checked = saved.includeSmall;
  } catch {
    // localStorage를 사용할 수 없거나 저장된 값이 깨진 경우 기본값을 쓴다.
  }
  syncOptionsFromForm();
}

function savePrefs() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        queries: els.queryInput.value,
        mode: state.mode,
        limitPerQuery: state.limitPerQuery,
        maxTotalWorks: state.maxTotalWorks,
        includeSpecial: state.includeSpecial,
        includeSmall: state.includeSmall,
        sort: state.sort,
      }),
    );
  } catch {
    // 저장 실패는 조회 기능에 영향을 주지 않는다.
  }
}

function syncOptionsFromForm() {
  const mode = document.querySelector('input[name="mode"]:checked')?.value;
  state.mode = mode === 'all' ? 'all' : 'title';
  state.limitPerQuery = Number.parseInt(els.limitPerQuery.value, 10) || 100;
  state.maxTotalWorks = Number.parseInt(els.maxTotalWorks.value, 10) || 300;
  state.includeSpecial = els.includeSpecial.checked;
  state.includeSmall = els.includeSmall.checked;
}

function setMode(mode) {
  const input = document.querySelector(`input[name="mode"][value="${mode}"]`);
  if (input) input.checked = true;
}

/* ------------------------------------------------------------------ */
/* 입력                                                                */
/* ------------------------------------------------------------------ */

function parseQueries() {
  const seen = new Set();
  const result = [];
  for (const line of els.queryInput.value.split(/\r?\n/)) {
    const query = line.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!query) continue;
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(query);
    if (result.length >= MAX_QUERIES) break;
  }
  return result;
}

function updateQueryCount() {
  const count = parseQueries().length;
  els.queryCount.textContent = count > 0 ? `${count}권 입력` : '0권 입력';
}

function addExample(example) {
  if (!example) return;
  const current = els.queryInput.value.trimEnd();
  if (!current) {
    els.queryInput.value = example;
  } else if (!parseQueries().some((query) => query.toLowerCase() === example.toLowerCase())) {
    els.queryInput.value = `${current}\n${example}`;
  }
  updateQueryCount();
  savePrefs();
  els.queryInput.focus();
  els.queryInput.setSelectionRange(els.queryInput.value.length, els.queryInput.value.length);
}

/* ------------------------------------------------------------------ */
/* 조회                                                                */
/* ------------------------------------------------------------------ */

async function startSearch({ fresh = false, queriesOverride = null } = {}) {
  const queries = Array.isArray(queriesOverride) && queriesOverride.length > 0
    ? queriesOverride
    : parseQueries();
  if (queries.length === 0) {
    showToast('책 제목을 한 개 이상 입력해 주세요.', 'warn');
    els.queryInput.focus();
    return;
  }

  if (state.isSearching) {
    state.cancelled = true;
    state.controller?.abort();
  }

  syncOptionsFromForm();
  savePrefs();

  const searchId = ++state.searchId;
  clearTimeout(state.progressHideTimer);

  state.queries = queries;
  state.books = new Map();
  state.entriesByKey = new Map();
  state.queryStats = [];
  state.warnings = [];
  state.filter = 'all';
  state.queryFilter = null;
  state.planReceived = false;
  state.finishRequested = false;
  state.cancelled = false;
  state.done = false;
  state.error = null;
  state.totalWorks = 0;
  state.doneCount = 0;
  state.startedAt = Date.now();
  state.finishedAt = null;
  state.elapsedMs = 0;
  state.isSearching = true;
  state.controller = new AbortController();

  hideError();
  els.searchBtn.disabled = true;
  els.searchBtn.classList.add('loading');
  els.cancelBtn.hidden = false;
  els.cancelBtn.disabled = false;
  els.progressPanel.hidden = false;
  els.emptyState.hidden = true;
  els.emptyState.innerHTML = '';
  els.bookList.innerHTML = '';
  els.warningList.hidden = true;
  els.queryFilter.hidden = true;

  setProgress(3, '도서관 카탈로그에 연결 중…', `${queries.length}개 검색어 · 잠시만 기다려 주세요.`);
  renderAll();

  try {
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        queries,
        mode: state.mode,
        limitPerQuery: state.limitPerQuery,
        maxTotalWorks: state.maxTotalWorks,
        fresh,
      }),
      signal: state.controller.signal,
    });

    if (searchId !== state.searchId) return;

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `조회 요청 실패 (HTTP ${response.status})`);
    }
    if (!response.body) {
      throw new Error('이 브라우저에서는 스트리밍 응답을 사용할 수 없습니다.');
    }

    await consumeNdjson(response.body, searchId);
    finishSearchOnce({}, searchId);
  } catch (error) {
    if (searchId !== state.searchId) return;

    if (error?.name === 'AbortError' || state.cancelled) {
      finishSearchOnce({ cancelled: true }, searchId);
      return;
    }

    state.error = error?.message || '조회 중 알 수 없는 오류가 발생했습니다.';
    showError(state.error);
    finishSearchOnce({ error: true }, searchId);
  }
}

async function consumeNdjson(body, searchId) {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (searchId !== state.searchId) {
        await reader.cancel().catch(() => {});
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          handleEvent(JSON.parse(line), searchId);
        } catch (error) {
          console.warn('조회 이벤트를 해석하지 못했습니다.', error, line);
        }
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      try {
        handleEvent(JSON.parse(buffer.trim()), searchId);
      } catch (error) {
        console.warn('마지막 조회 이벤트를 해석하지 못했습니다.', error, buffer);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // 이미 해제된 경우 무시한다.
    }
  }
}

function handleEvent(event, searchId) {
  if (searchId !== state.searchId) return;

  switch (event.type) {
    case 'start': {
      setProgress(4, '검색어 준비 완료', `${event.queries?.length ?? state.queries.length}개 검색어를 조회합니다.`);
      break;
    }

    case 'query-start': {
      const percent = 5 + (event.index / Math.max(1, event.total)) * 40;
      setProgress(
        percent,
        `“${event.query}” 검색 중`,
        `${event.index + 1} / ${event.total} 검색어 · 카탈로그 페이지를 확인하고 있습니다.`,
      );
      break;
    }

    case 'query': {
      state.queryStats.push(event);
      if (event.error) {
        showToast(`“${event.query}” 조회 실패`, 'warn');
      }
      break;
    }

    case 'plan': {
      state.planReceived = true;
      state.totalWorks = event.totalWorks ?? 0;
      state.warnings = Array.isArray(event.warnings) ? [...event.warnings] : [];
      renderAll();

      if (state.totalWorks === 0) {
        setProgress(100, '조회 완료', '조건에 맞는 책이 없습니다.');
      } else {
        setProgress(
          45,
          `${numberFormat.format(state.totalWorks)}권 소장 정보 조회 중`,
          '각 판본의 소장 도서관과 대출 상태를 가져옵니다.',
        );
      }
      break;
    }

    case 'book': {
      if (!event.book?.key) break;
      state.books.set(event.book.key, event.book);
      state.doneCount = Math.max(state.doneCount, state.books.size);
      scheduleRender();

      if (state.totalWorks > 0) {
        const percent = 45 + (state.doneCount / state.totalWorks) * 53;
        setProgress(
          percent,
          `소장 정보 ${numberFormat.format(state.doneCount)} / ${numberFormat.format(state.totalWorks)}권`,
          '목동이음터와 타관의 비치 여부를 확인하고 있습니다.',
        );
      }
      break;
    }

    case 'progress': {
      state.doneCount = Math.max(state.doneCount, event.done ?? 0);
      break;
    }

    case 'warning': {
      if (event.message && !state.warnings.includes(event.message)) {
        state.warnings.push(event.message);
        renderAll();
      }
      break;
    }

    case 'done': {
      state.done = true;
      state.totalWorks = event.totalBooks ?? state.totalWorks;
      state.doneCount = event.totalBooks ?? state.doneCount;
      state.elapsedMs = event.elapsedMs ?? 0;
      state.warnings = Array.isArray(event.warnings) ? [...event.warnings] : state.warnings;
      setProgress(
        100,
        event.aborted ? '조회 중단됨' : '조회 완료',
        `${numberFormat.format(event.totalBooks ?? state.books.size)}권 · ${(state.elapsedMs / 1000).toFixed(1)}초`,
      );
      finishSearchOnce({ cancelled: Boolean(event.aborted) }, searchId);
      break;
    }

    case 'error': {
      state.error = event.message || '조회 중 오류가 발생했습니다.';
      showError(state.error);
      finishSearchOnce({ error: true }, searchId);
      break;
    }

    default:
      break;
  }
}

function finishSearchOnce(options, searchId) {
  if (searchId !== state.searchId || state.finishRequested) return;
  state.finishRequested = true;
  finalizeSearch(options);
}

function finalizeSearch({ cancelled = false, error = false } = {}) {
  state.isSearching = false;
  state.done = true;
  state.finishedAt = new Date();
  if (!state.elapsedMs && state.startedAt) {
    state.elapsedMs = Date.now() - state.startedAt;
  }
  els.searchBtn.disabled = false;
  els.searchBtn.classList.remove('loading');
  els.cancelBtn.hidden = true;

  clearTimeout(state.renderTimer);
  state.renderTimer = null;

  if (error) {
    els.progressPanel.hidden = true;
  } else {
    setProgress(
      100,
      cancelled ? '조회 중단됨' : '조회 완료',
      `${numberFormat.format(state.books.size)}권 표시 · ${(state.elapsedMs / 1000).toFixed(1)}초`,
    );
    state.progressHideTimer = setTimeout(() => {
      if (!state.isSearching) els.progressPanel.hidden = true;
    }, 1800);
  }

  renderAll();

  if (cancelled) {
    showToast('조회를 중단했습니다. 현재까지 받은 결과만 표시합니다.', 'warn');
  } else if (error) {
    showToast(state.error || '조회 중 오류가 발생했습니다.', 'error');
  } else if (state.books.size === 0) {
    showToast('조건에 맞는 책을 찾지 못했습니다.', 'warn');
  } else {
    showToast(`${numberFormat.format(state.books.size)}권 조회 완료`);
  }
}

function cancelSearch() {
  if (!state.isSearching) return;
  state.cancelled = true;
  state.controller?.abort();
  els.cancelBtn.disabled = true;
  setTimeout(() => {
    els.cancelBtn.disabled = false;
  }, 400);
}

function resetAll() {
  state.searchId += 1;
  if (state.isSearching) {
    state.cancelled = true;
    state.controller?.abort();
  }

  clearTimeout(state.progressHideTimer);
  clearTimeout(state.renderTimer);

  state.queries = [];
  state.books = new Map();
  state.entriesByKey = new Map();
  state.queryStats = [];
  state.warnings = [];
  state.filter = 'all';
  state.queryFilter = null;
  state.planReceived = false;
  state.finishRequested = false;
  state.cancelled = false;
  state.done = false;
  state.error = null;
  state.totalWorks = 0;
  state.doneCount = 0;
  state.startedAt = 0;
  state.finishedAt = null;
  state.elapsedMs = 0;
  state.isSearching = false;
  state.controller = null;
  state.renderTimer = null;

  els.queryInput.value = '';
  els.searchBtn.disabled = false;
  els.searchBtn.classList.remove('loading');
  els.cancelBtn.hidden = true;
  els.progressPanel.hidden = true;
  els.summarySection.hidden = true;
  els.resultsSection.hidden = true;
  els.emptyLanding.hidden = false;
  els.bookList.innerHTML = '';
  els.emptyState.hidden = true;
  els.emptyState.innerHTML = '';
  els.warningList.hidden = true;
  els.queryFilter.hidden = true;

  hideError();
  updateQueryCount();
  savePrefs();
  els.queryInput.focus();
}

/* ------------------------------------------------------------------ */
/* 렌더링                                                              */
/* ------------------------------------------------------------------ */

function renderAll() {

  if (state.queries.length === 0) {
    els.emptyLanding.hidden = false;
    els.summarySection.hidden = true;
    els.resultsSection.hidden = true;
    return;
  }

  const all = getAllClassified();
  state.entriesByKey = new Map(all.map((entry) => [entry.book.key, entry]));
  const scoped = state.queryFilter
    ? all.filter((entry) => (entry.book.queries || []).includes(state.queryFilter))
    : all;
  const visible = getVisibleBooks(scoped);

  const showResults = state.isSearching || state.planReceived || all.length > 0 || state.done || Boolean(state.error);
  els.emptyLanding.hidden = showResults;
  els.summarySection.hidden = !showResults;
  els.resultsSection.hidden = !showResults;
  if (!showResults) return;

  renderSummary(all, scoped);
  renderWarnings(all);
  renderStatusTabs(scoped);
  renderQueryFilter(all);
  renderResultMeta(all, scoped, visible);
  renderBookList(visible, scoped);
}

function scheduleRender() {
  if (state.renderTimer) return;
  state.renderTimer = setTimeout(() => {
    state.renderTimer = null;
    renderAll();
  }, 130);
}

function getAllClassified() {
  const options = {
    includeSpecial: state.includeSpecial,
    includeSmall: state.includeSmall,
  };
  return [...state.books.values()].map((book) => classifyBook(book, options));
}

function classifyBook(book, options) {
  const allHoldings = Array.isArray(book.holdings) ? book.holdings : [];
  const filtered = allHoldings.filter((holding) => {
    if (!options.includeSmall && holding.small) return false;
    if (!options.includeSpecial && holding.format !== 'regular') return false;
    return true;
  });

  const mi = filtered.filter((holding) => holding.lib === TARGET_LIBRARY);
  const others = filtered.filter((holding) => holding.lib !== TARGET_LIBRARY);
  const miSorted = sortCopies(mi);
  const othersSorted = sortCopies(others);

  const miAvailable = miSorted.filter((holding) => holding.available);
  const otherAvailable = othersSorted.filter((holding) => holding.available);
  const miRegular = miSorted.filter((holding) => holding.format === 'regular');
  const miRegularAvailable = miRegular.filter((holding) => holding.available);
  const otherAvailableSorted = [...otherAvailable].sort(compareOtherAvailable);

  let status;
  if (miAvailable.length > 0) status = 'green';
  else if (mi.length > 0 && otherAvailable.length > 0) status = 'yellow';
  else if (mi.length === 0 && otherAvailable.length > 0) status = 'blue';
  else status = 'red';

  const mutual =
    (status === 'yellow' || status === 'blue') && otherAvailable.some((holding) => holding.mutualLoan);
  const reservation = status !== 'green' && mi.some((holding) => holding.reservation);

  const primary =
    miRegularAvailable[0] ||
    miAvailable[0] ||
    miSorted[0] ||
    otherAvailableSorted[0] ||
    othersSorted[0] ||
    null;

  const allGroups = groupByLibrary(filtered);
  const miGroup = allGroups.find((group) => group.lib === TARGET_LIBRARY) || null;
  const otherGroups = allGroups.filter((group) => group.lib !== TARGET_LIBRARY);
  const otherAvailableGroups = groupByLibrary(otherAvailableSorted);
  const excluded = allHoldings.length - filtered.length;
  const reason = buildReason({
    status,
    mi,
    miAvailable,
    otherAvailable,
    filtered,
    allHoldings,
    book,
  });

  return {
    book,
    status,
    holdings: filtered,
    allHoldings,
    excluded,
    mi: miSorted,
    miAvailable,
    miGroup,
    others: othersSorted,
    otherAvailable,
    otherAvailableGroups,
    otherGroups,
    allGroups,
    mutual,
    reservation,
    primary,
    primaryCall: primary?.callNumber || '',
    primaryLocation: primary?.location || '',
    primaryLibName: primary?.libName || '',
    reason,
  };
}

function buildReason({ status, mi, miAvailable, otherAvailable, filtered, allHoldings, book }) {
  if (book.error && allHoldings.length === 0) {
    return '소장 정보를 불러오지 못했습니다. 새로고침을 시도해 주세요.';
  }
  if (filtered.length === 0 && allHoldings.length > 0) {
    return '선택한 자료 범위에서는 소장·비치 정보가 없습니다.';
  }
  if (allHoldings.length === 0) {
    return '화성시립도서관 관내에 소장 정보가 없습니다.';
  }

  if (status === 'green') {
    const regularAvailable = miAvailable.filter((holding) => holding.format === 'regular').length;
    if (regularAvailable > 0) {
      return `목동이음터 일반자료 ${regularAvailable}권이 지금 비치 중입니다.`;
    }
    return `목동이음터 점자·큰글자 자료 ${miAvailable.length}권이 지금 비치 중입니다.`;
  }

  if (status === 'yellow') {
    return `목동이음터 소장 ${mi.length}권이 모두 대출 중입니다. 타관 ${otherAvailable.length}권은 지금 비치 중입니다.`;
  }

  if (status === 'blue') {
    return `목동이음터에는 없고, 타관 ${otherAvailable.length}권이 지금 비치 중입니다.`;
  }

  if (mi.length > 0) {
    return `목동이음터 소장 ${mi.length}권을 포함해 관내 모든 소장본이 대출 중이거나 이용할 수 없습니다.`;
  }

  return '화성시립도서관 관내에 이 책의 비치된 소장본이 없습니다.';
}

function sortCopies(rows) {
  return [...rows].sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    const formatA = a.format === 'regular' ? 0 : 1;
    const formatB = b.format === 'regular' ? 0 : 1;
    if (formatA !== formatB) return formatA - formatB;
    if (a.lib !== b.lib) return (a.libName || '').localeCompare(b.libName || '', 'ko');
    return callSortKey(a.callNumber).localeCompare(callSortKey(b.callNumber));
  });
}

function compareOtherAvailable(a, b) {
  const mutualA = a.mutualLoan ? 0 : 1;
  const mutualB = b.mutualLoan ? 0 : 1;
  if (mutualA !== mutualB) return mutualA - mutualB;

  if (a.small !== b.small) return a.small ? 1 : -1;

  const formatA = a.format === 'regular' ? 0 : 1;
  const formatB = b.format === 'regular' ? 0 : 1;
  if (formatA !== formatB) return formatA - formatB;

  if (a.libName !== b.libName) return (a.libName || '').localeCompare(b.libName || '', 'ko');
  return callSortKey(a.callNumber).localeCompare(callSortKey(b.callNumber));
}

function groupByLibrary(rows) {
  const map = new Map();
  for (const row of rows) {
    let group = map.get(row.lib);
    if (!group) {
      group = {
        lib: row.lib,
        libName: row.libName || row.lib,
        small: Boolean(row.small),
        copies: [],
        available: 0,
        total: 0,
      };
      map.set(row.lib, group);
    }
    group.copies.push(row);
    group.total += 1;
    if (row.available) group.available += 1;
  }

  const groups = [...map.values()];
  for (const group of groups) {
    group.copies = sortCopies(group.copies);
  }

  groups.sort((a, b) => {
    if (a.lib === TARGET_LIBRARY && b.lib !== TARGET_LIBRARY) return -1;
    if (b.lib === TARGET_LIBRARY && a.lib !== TARGET_LIBRARY) return 1;
    if (a.available !== b.available) return b.available - a.available;
    if (a.small !== b.small) return a.small ? 1 : -1;
    return (a.libName || '').localeCompare(b.libName || '', 'ko');
  });

  return groups;
}

function getVisibleBooks(scoped) {
  let visible = scoped;
  if (state.filter !== 'all') {
    visible = visible.filter((entry) => entry.status === state.filter);
  }

  return [...visible].sort((a, b) => {
    const callA = a.primaryCall ? callSortKey(a.primaryCall) : '\uffff';
    const callB = b.primaryCall ? callSortKey(b.primaryCall) : '\uffff';
    const byCall = callA.localeCompare(callB);
    if (byCall !== 0) return byCall;
    const byTitle = collator.compare(a.book.title || '', b.book.title || '');
    if (byTitle !== 0) return byTitle;
    return collator.compare(a.book.author || '', b.book.author || '');
  });
}

function renderSummary(all, scoped) {
  const counts = { green: 0, yellow: 0, blue: 0, red: 0 };
  for (const entry of scoped) counts[entry.status] += 1;

  const mutualCount = scoped.filter((entry) => entry.mutual).length;
  const reservationCount = scoped.filter((entry) => entry.reservation).length;
  const errorCount = scoped.filter((entry) => entry.book.error).length;

  const when = state.finishedAt ? `${timeFormat.format(state.finishedAt)} 기준` : '조회 중';
  const elapsed = state.elapsedMs > 0 ? ` · ${(state.elapsedMs / 1000).toFixed(1)}초` : '';
  const scopeText =
    scoped.length !== all.length ? ` · 현재 검색어 ${numberFormat.format(scoped.length)}권` : '';
  els.summaryMeta.innerHTML = `총 <strong>${numberFormat.format(all.length)}</strong>권 · 검색어 ${numberFormat.format(state.queries.length)}개${scopeText} · ${when}${elapsed}`;

  const extra = [];
  if (scoped.length > 0) {
    extra.push(`상호대차 가능 <strong>${numberFormat.format(mutualCount)}</strong>권`);
    extra.push(`대출예약 가능 <strong>${numberFormat.format(reservationCount)}</strong>권`);
  }
  if (state.isSearching && state.totalWorks > 0) {
    extra.push(`소장 정보 ${numberFormat.format(state.books.size)} / ${numberFormat.format(state.totalWorks)}권 확인 중`);
  }
  if (errorCount > 0) {
    extra.push(`조회 실패 <strong>${numberFormat.format(errorCount)}</strong>권`);
  }
  els.summaryExtra.innerHTML = extra.join('<span class="split">|</span>');

  const cards = [
    { key: 'green', label: '목동 비치중' },
    { key: 'yellow', label: '대출중 · 타관 가능' },
    { key: 'blue', label: '타관에만 있음' },
    { key: 'red', label: '전체 미소장/불가' },
  ];

  els.statGrid.innerHTML = cards
    .map((card) => {
      const meta = STATUS_META[card.key];
      const active = state.filter === card.key ? ' active' : '';
      return `<button type="button" class="stat-card status-${card.key}${active}" data-filter="${card.key}" aria-pressed="${state.filter === card.key}">
        <span class="stat-icon" aria-hidden="true">${meta.icon}</span>
        <span class="stat-text">
          <span class="stat-num">${numberFormat.format(counts[card.key])}</span>
          <span class="stat-label">${card.label}</span>
        </span>
      </button>`;
    })
    .join('');
}

function renderWarnings(all) {
  const warnings = [...state.warnings];

  const errorBooks = all.filter((entry) => entry.book.error).length;
  if (errorBooks > 0) warnings.push(`소장 정보를 불러오지 못한 책이 ${errorBooks}권 있습니다.`);
  const partialBooks = all.filter((entry) => entry.book.partial).length;
  if (partialBooks > 0) warnings.push(`일부 판본만 조회된 책이 ${partialBooks}권 있습니다.`);

  const excludedBooks = all.filter((entry) => entry.excluded > 0).length;
  if (excludedBooks > 0 && (!state.includeSpecial || !state.includeSmall)) {
    warnings.push(`선택한 자료 범위에서 제외된 소장본이 있는 책이 ${excludedBooks}권 있습니다.`);
  }

  const unique = [...new Set(warnings)].filter(Boolean);
  els.warningList.innerHTML = unique.map((warning) => `<p>${escapeHtml(warning)}</p>`).join('');
  els.warningList.hidden = unique.length === 0;
}

function renderStatusTabs(scoped) {
  const counts = { all: scoped.length, green: 0, yellow: 0, blue: 0, red: 0 };
  for (const entry of scoped) counts[entry.status] += 1;

  const tabs = [
    { key: 'green', label: '목동 비치', icon: '🟢' },
    { key: 'yellow', label: '대출중·타관', icon: '🟡' },
    { key: 'blue', label: '타관만', icon: '🔵' },
    { key: 'red', label: '대출불가', icon: '🔴' },
  ];

  els.statusTabs.innerHTML = tabs
    .map((tab) => {
      const active = state.filter === tab.key;
      return `<button type="button" class="tab${active ? ' active' : ''}" data-filter="${tab.key}" aria-pressed="${active}">
        ${tab.icon ? `${tab.icon} ` : ''}${tab.label}
        <span class="tab-count">${numberFormat.format(counts[tab.key])}</span>
      </button>`;
    })
    .join('');
}

function renderQueryFilter(all) {
  if (state.queries.length <= 1) {
    els.queryFilter.hidden = true;
    els.queryFilter.innerHTML = '';
    return;
  }

  const counts = new Map(state.queries.map((query) => [query, 0]));
  for (const entry of all) {
    for (const query of entry.book.queries || []) {
      if (counts.has(query)) counts.set(query, counts.get(query) + 1);
    }
  }

  const chips = [];

  for (const query of state.queries) {
    const active = state.queryFilter === query;
    chips.push(`<button type="button" class="query-chip${active ? ' active' : ''}" data-query="${escapeAttr(query)}">
      ${escapeHtml(query)} <span class="q-count">${numberFormat.format(counts.get(query) || 0)}</span>
    </button>`);
  }

  els.queryFilter.innerHTML = chips.join('');
  els.queryFilter.hidden = false;
}

function renderResultMeta(all, scoped, visible) {
  if (state.isSearching && state.planReceived && state.totalWorks === 0) {
    els.resultMeta.textContent = '조건에 맞는 책이 없습니다.';
    return;
  }

  if (state.isSearching && state.books.size < (state.totalWorks || Number.POSITIVE_INFINITY)) {
    const total = state.totalWorks > 0 ? ` / ${numberFormat.format(state.totalWorks)}` : '';
    els.resultMeta.textContent = `소장 정보 ${numberFormat.format(state.books.size)}${total}권 확인 중…`;
    return;
  }

  if (state.isSearching) {
    els.resultMeta.textContent = '조회 중…';
    return;
  }

  let text = `${numberFormat.format(visible.length)}권 표시 · 청구기호순`;
  if (state.queryFilter) text += ` · 검색어 “${state.queryFilter}”`;
  if (scoped.length !== all.length) text += ` · 검색어 필터 적용`;
  els.resultMeta.textContent = text;
}

function renderBookList(visible, scoped) {
  els.bookList.innerHTML = visible.map((entry) => renderBookCard(entry)).join('');

  let empty = null;

  if (state.books.size === 0) {
    if (state.isSearching && !state.planReceived) {
      empty = {
        icon: '🔎',
        title: '책을 찾고 있습니다',
        description: '도서관 카탈로그에서 검색어에 맞는 자료를 확인하는 중입니다.',
        action: null,
      };
    } else if (state.isSearching && state.planReceived) {
      empty = {
        icon: '📚',
        title: '소장 정보를 불러오는 중',
        description: '목동이음터와 타관의 대출 상태를 확인하고 있습니다.',
        action: null,
      };
    } else if (state.error) {
      empty = {
        icon: '⚠️',
        title: '조회 결과를 표시할 수 없습니다',
        description: state.error,
        action: 'focus',
      };
    } else if (state.done) {
      empty = {
        icon: '📭',
        title: '조회된 책이 없습니다',
        description:
          '제목을 바꾸거나 검색 옵션에서 “도서관 검색 결과 전체”를 선택해 보세요. 제목 일부만 입력해도 됩니다.',
        action: 'focus',
      };
    }
  } else if (visible.length === 0) {
    if (state.isSearching) {
      empty = {
        icon: '⏳',
        title: '이 조건에 맞는 책을 확인 중입니다',
        description: '조회가 끝나면 다시 확인해 주세요.',
        action: null,
      };
    } else {
      empty = {
        icon: '🔍',
        title: '이 조건에 맞는 책이 없습니다',
        description: '다른 상태 탭을 선택하거나 검색어 필터를 해제해 보세요.',
        action: 'reset-filter',
      };
    }
  }

  if (!empty) {
    els.emptyState.hidden = true;
    els.emptyState.innerHTML = '';
    return;
  }

  const action =
    empty.action === 'reset-filter'
      ? '<button type="button" class="btn small" data-action="reset-filter">필터 해제</button>'
      : empty.action === 'focus'
        ? '<button type="button" class="btn small" data-action="focus-input">제목 다시 입력</button>'
        : '';

  els.emptyState.innerHTML = `<div class="empty-icon" aria-hidden="true">${empty.icon}</div>
    <h3>${escapeHtml(empty.title)}</h3>
    <p>${escapeHtml(empty.description)}</p>
    ${action}`;
  els.emptyState.hidden = false;
}

/* ------------------------------------------------------------------ */
/* 카드                                                                */
/* ------------------------------------------------------------------ */

function renderBookCard(entry) {
  const { book, status } = entry;
  const meta = STATUS_META[status];
  const customCover = getCustomCover(book);
  const cover = customCover || safeUrl(book.cover);
  const detailUrl = safeUrl(book.detailUrl);
  const queries = book.queries || [];
  const title = book.title || '제목 없음';
  const fullTitle = (book.fullTitle || '').trim();
  const showSubtitle = fullTitle && fullTitle !== title && !sameTitle(fullTitle, title);

  const metaParts = [book.author, book.year].filter(Boolean).map((part) => escapeHtml(part));
  const callLine =
    entry.primaryCall
      ? `<p class="call-line"><span class="call-label">청구기호</span> <strong>${escapeHtml(entry.primaryCall)}</strong>${entry.primaryLocation ? `<span class="call-loc"> · ${escapeHtml(entry.primaryLocation)}</span>` : ''}${entry.primaryLibName ? `<span class="call-lib"> · ${escapeHtml(entry.primaryLibName)}</span>` : ''}</p>`
      : '';

  const badgeRow = [];
  if (status === 'yellow' || status === 'blue') {
    badgeRow.push(
      entry.mutual
        ? '<span class="mini-badge good">상호대차 가능</span>'
        : '<span class="mini-badge muted">상호대차 불가</span>',
    );
  }
  if (entry.reservation) badgeRow.push('<span class="mini-badge warn">대출예약 가능</span>');

  const coverHtml = `<div class="cover-wrap${customCover ? ' has-custom' : ''}">
    <div class="cover-fallback" aria-hidden="true">📖</div>
    ${cover ? `<img class="cover-img" src="${escapeAttr(cover)}" alt="" loading="lazy" onerror="this.classList.add('is-broken')">` : ''}
    <button type="button" class="cover-add-btn" data-action="add-cover" data-key="${escapeAttr(book.key)}">🖼 이미지 추가</button>
  </div>`;

  const errorHtml = book.error ? `<div class="book-error">${escapeHtml(book.error)}</div>` : '';
  const partialHtml = book.partial && book.partialNote ? `<div class="book-error">${escapeHtml(book.partialNote)}</div>` : '';

  const miHtml = renderTargetBlock(entry);
  const otherHtml = renderOtherBlock(entry);
  const detailsHtml = renderDetails(entry);
  const footerHtml = renderFooter(book, detailUrl);

  return `<article class="book-card status-${status}">
    <div class="book-main">
      ${coverHtml}
      <div class="book-body">
        <div class="book-head">
          <div class="title-wrap">
            <h3 class="book-title">${escapeHtml(title)}</h3>
          </div>
          <span class="status-badge">${meta.icon} ${meta.label}</span>
        </div>

        ${metaParts.length ? `<p class="book-meta">${metaParts.join('<span class="dot">·</span>')}</p>` : ''}
        ${callLine}

        ${badgeRow.length > 0 ? `<div class="badge-row">${badgeRow.join('')}</div>` : ''}
        ${errorHtml}
        ${partialHtml}

        <div class="holdings-summary">
          ${miHtml}
          ${otherHtml}
        </div>

        ${detailsHtml}
        ${footerHtml}
      </div>
    </div>
  </article>`;
}

function renderTargetBlock(entry) {
  const mi = entry.mi;
  const available = entry.miAvailable;
  const primaryMi = mi.find((holding) => holding.format === 'regular' && holding.available)
    || available[0]
    || mi[0]
    || null;

  let statusPill;
  if (available.length > 0) statusPill = `<span class="pill available">비치 ${available.length}</span>`;
  else if (mi.length > 0) statusPill = '<span class="pill loaned">대출중</span>';
  else statusPill = '<span class="pill unavailable">미소장</span>';

  let body;
  if (primaryMi) {
    const due = primaryMi.dueDate ? ` · 반납 ${escapeHtml(primaryMi.dueDate)}` : '';
    const formatTag =
      primaryMi.format === 'braille'
        ? ' · 점자'
        : primaryMi.format === 'large'
          ? ' · 큰글자'
          : '';
    body = `<p class="target-call">${escapeHtml(primaryMi.callNumber || '청구기호 없음')}${primaryMi.location ? ` · ${escapeHtml(primaryMi.location)}` : ''}${formatTag}${due}</p>`;
    if (mi.length > 1) {
      body += `<p class="more-line">외 ${mi.length - 1}권 · 상세 보기에서 확인</p>`;
    }
  } else {
    body = '<p class="block-note">목동이음터 소장본이 없습니다.</p>';
  }

  return `<section class="holding-block target">
    <h4>목동이음터 ${statusPill}</h4>
    ${body}
  </section>`;
}

function renderOtherBlock(entry) {
  const availableGroups = entry.otherAvailableGroups;
  const allOtherGroups = entry.otherGroups;

  if (availableGroups.length > 0) {
    const names = availableGroups.map((group) => escapeHtml(group.libName)).join(', ');
    const mutualBadge = entry.mutual
      ? '<span class="mini-badge good">상호대차</span>'
      : '<span class="mini-badge muted">상호대차 불가</span>';

    return `<section class="holding-block">
      <h4>타관 비치 ${mutualBadge}</h4>
      <p class="lib-line">${names}</p>
    </section>`;
  }

  if (allOtherGroups.length > 0) {
    const names = allOtherGroups.map((group) => escapeHtml(group.libName)).join(', ');
    return `<section class="holding-block">
      <h4>타관 소장 <span class="mini-badge muted">비치 없음</span></h4>
      <p class="lib-line">${names}</p>
    </section>`;
  }

  return `<section class="holding-block">
    <h4>타관 소장 <span class="mini-badge muted">없음</span></h4>
    <p class="block-note">타관에도 소장본이 없습니다.</p>
  </section>`;
}

function renderCopyRow(holding, compact) {
  const statusClass = holding.available
    ? 'available'
    : /대출중|예약중|상호대차중/.test(holding.status || '')
      ? 'loaned'
      : 'unavailable';

  const formatTag =
    holding.format === 'braille'
      ? '<span class="mini-badge neutral">점자</span>'
      : holding.format === 'large'
        ? '<span class="mini-badge neutral">큰글자</span>'
        : '';

  const services = [];
  if (holding.mutualLoan) services.push('<span class="mini-badge good">상호대차</span>');
  if (holding.reservation) services.push('<span class="mini-badge warn">대출예약</span>');
  if (!compact && (holding.services || []).includes('바로대출')) {
    services.push('<span class="mini-badge neutral">바로대출</span>');
  }

  const due = holding.dueDate ? `<span class="due">반납 ${escapeHtml(holding.dueDate)}</span>` : '';
  const reservations =
    holding.reservations > 0 ? `<span class="reservations">예약 ${holding.reservations}</span>` : '';

  return `<li class="copy-row">
    <div class="copy-main">
      <span class="copy-call">${escapeHtml(holding.callNumber || '청구기호 없음')}</span>
      <span class="copy-loc">${escapeHtml(holding.location || '위치 정보 없음')}</span>
    </div>
    <div class="copy-side">
      ${formatTag}
      <span class="pill ${statusClass}">${escapeHtml(displayStatus(holding))}</span>
      ${due}${reservations}${services.join('')}
    </div>
  </li>`;
}

function renderDetails(entry) {
  const { book } = entry;
  if (!entry.allGroups.length) return '';

  const total = book.holdingsTotal ?? entry.allHoldings.length;
  if (!total) return '';

  const editionText =
    book.editionsTotal > 1
      ? ` · 판본 ${book.editionsTotal}${book.editionsFetched ? ` 중 ${book.editionsFetched}개 조회` : ''}`
      : '';

  return `<details class="book-details" data-key="${escapeAttr(book.key)}">
    <summary>
      <span class="summary-chevron" aria-hidden="true"></span>
      소장 정보 보기 (${numberFormat.format(total)}권${editionText})
    </summary>
    <div class="details-inner" data-loaded="0"></div>
  </details>`;
}

function renderDetailsInner(entry) {
  const { book } = entry;

  const groups = entry.allGroups
    .map(
      (group) => `<div class="library-group">
        <div class="library-head">
          <strong>${escapeHtml(group.libName)}</strong>
          ${group.lib === TARGET_LIBRARY ? '<span class="mini-badge neutral">목동</span>' : group.small ? '<span class="mini-badge muted">작은도서관</span>' : ''}
          <span class="library-count">비치 ${group.available} / ${group.total}</span>
        </div>
        <ul class="copy-list">${group.copies.map((holding) => renderCopyRow(holding, false)).join('')}</ul>
      </div>`,
    )
    .join('');

  const isbns = (book.isbns || []).filter(Boolean);
  const editionLines = [];
  if (isbns.length > 0) editionLines.push(`<div><b>ISBN</b> ${escapeHtml(isbns.join(' / '))}</div>`);
  if (book.editionsTotal > 0) {
    editionLines.push(
      `<div><b>조회 판본</b> ${book.editionsFetched || 0} / ${book.editionsTotal}${
        book.editionsFetched < book.editionsTotal ? ' (상위 판본만 조회)' : ''
      }</div>`,
    );
  }
  if (entry.excluded > 0) {
    editionLines.push(
      `<div><b>옵션 제외</b> ${entry.excluded}권 (점자·큰글자 또는 작은도서관)</div>`,
    );
  }

  const editionInfo = editionLines.length
    ? `<div class="edition-info">${editionLines.join('')}</div>`
    : '';
  const partial = book.partialNote ? `<div class="partial-note">${escapeHtml(book.partialNote)}</div>` : '';

  return `${groups}${editionInfo}${partial}`;
}

function renderFooter(book, detailUrl) {
  if (!detailUrl) return '';
  return `<div class="book-footer">
    <a href="${escapeAttr(detailUrl)}" target="_blank" rel="noopener">카탈로그 ↗</a>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* 유틸                                                                */
/* ------------------------------------------------------------------ */

function displayStatus(holding) {
  if (holding.available) return '비치중';
  const raw = String(holding.status || '');
  const bracket = raw.match(/\[([^\]]+)]/);
  if (bracket) return bracket[1];
  return raw.replace(/\(.*$/, '').trim() || '확인 불가';
}

function earliestDue(copies) {
  const dates = copies.map((copy) => copy.dueDate).filter(Boolean).sort();
  return dates[0] || null;
}

function callSortKey(callNumber) {
  const raw = String(callNumber || '')
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

function sameTitle(a, b) {
  return String(a).replace(/\s+/g, ' ').trim() === String(b).replace(/\s+/g, ' ').trim();
}

function safeUrl(value) {
  if (!value) return '';
  const text = String(value).trim();
  if (/^data:image\/(?:png|jpe?g|webp|gif|bmp|avif);base64,/i.test(text)) return text;
  try {
    const url = new URL(text, window.location.origin);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch {
    // 잘못된 URL은 표시하지 않는다.
  }
  return '';
}

/* ------------------------------------------------------------------ */
/* 표지 이미지 직접 추가                                                 */
/* ------------------------------------------------------------------ */

function customCoverKeys(book) {
  const keys = [];
  if (book && book.key) keys.push(book.key);
  if (book && book.isbn) keys.push(`isbn:${book.isbn}`);
  if (book && Array.isArray(book.isbns)) {
    for (const isbn of book.isbns) {
      if (isbn) keys.push(`isbn:${isbn}`);
    }
  }
  return [...new Set(keys)];
}

function loadCustomCovers() {
  state.customCovers = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem(CUSTOM_COVER_STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const [key, value] of Object.entries(saved)) {
        const url = safeUrl(value);
        if (key && url) state.customCovers.set(key, url);
      }
    }
  } catch {
    state.customCovers = new Map();
  }
}

function persistCustomCovers() {
  try {
    localStorage.setItem(
      CUSTOM_COVER_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(state.customCovers)),
    );
    return true;
  } catch {
    return false;
  }
}

function getCustomCover(book) {
  for (const key of customCoverKeys(book)) {
    const value = state.customCovers.get(key);
    if (value) return value;
  }
  return '';
}

function setCustomCover(book, value) {
  const url = safeUrl(value);
  if (!url) return false;
  for (const key of customCoverKeys(book)) state.customCovers.set(key, url);
  if (!persistCustomCovers()) {
    for (const key of customCoverKeys(book)) state.customCovers.delete(key);
    return false;
  }
  return true;
}

function removeCustomCover(bookKey, book) {
  const keys = new Set([bookKey]);
  for (const key of customCoverKeys(book || { key: bookKey })) keys.add(key);
  for (const key of keys) state.customCovers.delete(key);
  persistCustomCovers();
}

function openCoverEditor(bookKey) {
  const book = state.books.get(bookKey);
  if (!book) return;
  state.coverEditorBookKey = bookKey;
  state.coverEditorDraft = getCustomCover(book) || safeUrl(book.cover);
  els.coverEditorBook.textContent = `${book.title || '제목 없음'}${book.author ? ` · ${book.author}` : ''}`;
  els.coverUrlInput.value = safeUrl(getCustomCover(book)) && !String(getCustomCover(book)).startsWith('data:') ? getCustomCover(book) : '';
  updateCoverEditorPreview();
  els.coverEditor.hidden = false;
  els.coverSaveBtn.disabled = !state.coverEditorDraft;
  els.coverRemoveBtn.disabled = !getCustomCover(book);
}

function closeCoverEditor() {
  els.coverEditor.hidden = true;
  state.coverEditorBookKey = null;
  state.coverEditorDraft = null;
}

function updateCoverEditorPreview() {
  const src = state.coverEditorDraft || '';
  els.coverEditorPreview.src = src;
  els.coverEditorPreview.hidden = !src;
  els.coverEditorEmpty.hidden = Boolean(src);
  els.coverSaveBtn.disabled = !src;
}

function setCoverDraft(value) {
  const url = safeUrl(value);
  if (!url) {
    showToast('이미지를 불러올 수 없습니다. 파일이나 URL을 확인해 주세요.', 'warn');
    return;
  }
  state.coverEditorDraft = url;
  updateCoverEditorPreview();
}

function saveCoverDraft() {
  const bookKey = state.coverEditorBookKey;
  const book = bookKey ? state.books.get(bookKey) : null;
  if (!book || !state.coverEditorDraft) return;
  if (!setCustomCover(book, state.coverEditorDraft)) {
    showToast('브라우저 저장 공간이 부족해 표지를 저장하지 못했습니다. 더 작은 이미지로 시도해 주세요.', 'error');
    return;
  }
  closeCoverEditor();
  renderAll();
  showToast('표지 이미지를 추가했습니다.');
}

function setCoverDraftFromFile(file) {
  if (!file || !String(file.type || '').startsWith('image/')) {
    showToast('이미지 파일만 사용할 수 있습니다.', 'warn');
    return;
  }
  if (file.size > MAX_COVER_FILE_BYTES) {
    showToast('10MB 이하의 이미지 파일만 사용할 수 있습니다.', 'warn');
    return;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const dataUrl = await resizeCoverImage(String(reader.result));
      setCoverDraft(dataUrl);
    } catch {
      setCoverDraft(String(reader.result));
    }
  };
  reader.onerror = () => {
    showToast('이미지 파일을 읽지 못했습니다.', 'error');
  };
  reader.readAsDataURL(file);
}

function resizeCoverImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const scale = Math.min(
          1,
          MAX_COVER_DIMENSION / Math.max(image.naturalWidth || 1, image.naturalHeight || 1),
        );
        const width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
        const height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) {
          resolve(dataUrl);
          return;
        }
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = reject;
    image.src = dataUrl;
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return character;
    }
  });
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/\r?\n/g, ' ');
}

function setProgress(percent, label, detail) {
  const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  els.progressPanel.hidden = false;
  els.progressBar.style.width = `${value}%`;
  els.progressPercent.textContent = `${value}%`;
  els.progressLabel.textContent = label;
  els.progressDetail.textContent = detail || '';
}

function showError(message) {
  els.errorBanner.innerHTML = `<span>${escapeHtml(message)}</span><button type="button" class="banner-close" aria-label="닫기">×</button>`;
  els.errorBanner.hidden = false;
}

function hideError() {
  els.errorBanner.hidden = true;
  els.errorBanner.innerHTML = '';
}

function showToast(message, type = 'info') {
  clearTimeout(state.toastTimer);
  els.toast.textContent = message;
  els.toast.className = `toast${type === 'warn' ? ' warn' : type === 'error' ? ' error' : ''}`;
  els.toast.hidden = false;
  state.toastTimer = setTimeout(
    () => {
      els.toast.hidden = true;
    },
    type === 'error' ? 5200 : 3200,
  );
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

function exportCsv() {
  const all = getAllClassified();
  const scoped = state.queryFilter
    ? all.filter((entry) => (entry.book.queries || []).includes(state.queryFilter))
    : all;
  const visible = getVisibleBooks(scoped);

  if (visible.length === 0) {
    showToast('저장할 조회 결과가 없습니다.', 'warn');
    return;
  }

  const headers = [
    '검색어',
    '상태',
    '제목',
    '저자',
    '출판사',
    '출판연도',
    'ISBN',
    '목동 청구기호',
    '목동 위치',
    '목동 상태',
    '목동 반납예정',
    '타관 상호대차',
    '대출예약',
    '타관 비치 도서관',
    '카탈로그 URL',
  ];

  const rows = visible.map((entry) => {
    const { book, mi, otherAvailable } = entry;
    const miAvailable = mi.filter((holding) => holding.available);
    const miPrimary = miAvailable[0] || mi[0] || null;
    const otherLibraries = [...new Set(otherAvailable.map((holding) => holding.libName))].join(' / ');
    const mutualAny = otherAvailable.some((holding) => holding.mutualLoan);

    return [
      (book.queries || []).join(' / '),
      STATUS_META[entry.status].label,
      book.title,
      book.author,
      book.publisher,
      book.year,
      book.isbn,
      miPrimary?.callNumber || '',
      miPrimary?.location || '',
      miPrimary ? displayStatus(miPrimary) : '미소장',
      miPrimary?.dueDate || '',
      mutualAny ? '가능' : '불가',
      mi.some((holding) => holding.reservation) ? '가능' : '불가',
      otherLibraries,
      book.detailUrl,
    ];
  });

  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `목동이음터_도서조회_${dateStamp()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  showToast(`${numberFormat.format(visible.length)}권을 CSV로 저장했습니다.`);
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function dateStamp() {
  const date = new Date();
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/* ------------------------------------------------------------------ */
/* 사진에서 책 제목 뽑기 (OCR)                                          */
/* ------------------------------------------------------------------ */

const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/tesseract.min.js';
let tesseractLoadPromise = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractLoadPromise) return tesseractLoadPromise;
  tesseractLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TESSERACT_CDN;
    script.async = true;
    script.onload = () => {
      if (window.Tesseract) resolve(window.Tesseract);
      else reject(new Error('OCR 라이브러리를 불러오지 못했습니다.'));
    };
    script.onerror = () => reject(new Error('OCR 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'));
    document.head.appendChild(script);
  });
  return tesseractLoadPromise;
}

function setOcrStatus(message) {
  els.ocrStatus.textContent = message || '';
}

function fileToObjectUrl(file) {
  return URL.createObjectURL(file);
}

async function extractTitlesFromPhoto(file) {
  if (!file || !String(file.type || '').startsWith('image/')) {
    setOcrStatus('이미지 파일만 사용할 수 있습니다.');
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    setOcrStatus('15MB 이하의 이미지 파일만 사용할 수 있습니다.');
    return;
  }

  const objectUrl = fileToObjectUrl(file);
  let canvas = null;
  let imageWidth = 0;
  let imageHeight = 0;
  let previewUrl = null;
  try {
    setOcrStatus('사진을 읽는 중…');
    const loaded = await loadPhotoImage(objectUrl);
    imageWidth = loaded.width;
    imageHeight = loaded.height;
    previewUrl = fileToObjectUrl(file);
    showPhotoPreview(previewUrl, file, imageWidth, imageHeight);
    canvas = await prepareOcrCanvas(loaded.image);

    setOcrStatus('OCR 라이브러리를 불러오는 중… (처음 한 번은 시간이 걸릴 수 있습니다)');
    const Tesseract = await loadTesseract();

    setOcrStatus('사진에서 글자를 읽는 중… (30초~1분 정도 걸릴 수 있습니다)');
    const { data } = await Tesseract.recognize(canvas, 'kor+eng', {
      tessedit_pageseg_mode: '6',
      logger: (message) => {
        if (message && message.status === 'recognizing text' && typeof message.progress === 'number') {
          setOcrStatus(`사진에서 글자를 읽는 중… ${Math.round(message.progress * 100)}%`);
        }
      },
    });

    if (data && typeof data.text === 'string') {
      els.ocrRawText.value = data.text;
      els.ocrRawBox.hidden = false;
    }

    let items = parseOcrItems(data, canvas);

    if (items.length < 8) {
      setOcrStatus('목록이 적습니다. 흩어진 글자 모드로 다시 읽는 중…');
      try {
        const sparse = await Tesseract.recognize(canvas, 'kor+eng', { tessedit_pageseg_mode: '11' });
        const merged = mergeOcrItems(items, parseOcrItems(sparse.data, canvas));
        if (merged.length > items.length) items = merged;
      } catch {
        // 보조 인식은 실패해도 앞 결과를 쓴다.
      }
    }

    if (items.length < 8) {
      setOcrStatus('목록이 여전히 적습니다. 사진을 잘라서 다시 읽는 중…');
      try {
        const sliced = await recognizeSliced(Tesseract, canvas);
        const merged = mergeOcrItems(items, parseOcrItems(sliced, canvas));
        if (merged.length > items.length) items = merged;
      } catch {
        // 잘라서 읽기는 선택 사항이라 실패해도 앞 결과를 쓴다.
      }
    }

    if (items.length === 0) {
      setOcrStatus('책 제목으로 보이는 글자를 찾지 못했습니다. 사진이 흐리거나 너무 작지 않은지 확인해 주세요. 아래 읽은 글자 원문을 확인하고 직접 고쳐 넣으세요.');
      els.ocrResults.hidden = false;
      state.ocrItems = [];
      els.ocrList.innerHTML = '';
      els.ocrCount.textContent = '제목 0권';
      return;
    }

    state.ocrItems = items;
    renderOcrItems();
    const checkedTitles = checkedOcrTitles();
    const excluded = items.filter((item) => !item.checked).length;
    setOcrStatus(`제목 ${items.length}개를 뽑았습니다. 검색창에 ${checkedTitles.length}권을 넣었습니다.${excluded ? ` 빨강+초록 둘 다 읽은 ${excluded}개는 제외했습니다.` : ''} 아래 도서 조회를 누르세요. 틀린 제목은 목록에서 고쳐 넣으세요.`);
    if (checkedTitles.length > 0) {
      applyOcrTitles(false, true);
      focusQueryInput();
    }
    showToast(`사진에서 제목 ${items.length}개를 뽑았습니다.`);
  } catch (error) {
    setOcrStatus(`${error && error.message ? error.message : '사진을 읽지 못했습니다.'} 사진은 위 미리보기에 표시됩니다. 인터넷 연결을 확인하고 다시 사진으로 바꿔 보세요.`);
  } finally {
    URL.revokeObjectURL(objectUrl);
    if (previewUrl && previewUrl !== objectUrl) {
      // 미리보기는 화면에 남겨 둔다. 다음 사진이 들어오면 교체된다.
    }
  }
}

function showPhotoPreview(previewUrl, file, width, height) {
  if (!els.photoPreviewBox || !els.photoPreviewImg) return;
  els.photoPreviewImg.src = previewUrl;
  const size = formatFileSize(file.size);
  const name = file.name || '붙여넣은 사진';
  const dims = width && height ? ` · ${width}×${height}px` : '';
  els.photoMeta.textContent = `✔ 사진이 들어왔습니다: ${name} (${size}${dims}) — 제목을 뽑는 중입니다.`;
  els.photoPreviewBox.hidden = false;
  els.photoPreviewImg.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function clearPhotoSelection() {
  els.photoPreviewBox.hidden = true;
  els.photoPreviewImg.removeAttribute('src');
  els.photoMeta.textContent = '';
  els.ocrResults.hidden = true;
  els.ocrRawBox.hidden = true;
  state.ocrItems = [];
  setOcrStatus('');
  els.photoInput.value = '';
}

function focusQueryInput() {
  if (!els.queryInput) return;
  els.queryInput.classList.add('query-flash');
  els.queryInput.focus();
  els.queryInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => els.queryInput.classList.remove('query-flash'), 1600);
}

function formatFileSize(bytes) {
  if (!bytes) return '0B';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function loadPhotoImage(objectUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ image, width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
    image.onerror = () => reject(new Error('이미지 파일을 열지 못했습니다.'));
    image.src = objectUrl;
  });
}

function computeOtsuThreshold(histogram) {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  if (total === 0) return 165;
  let sumAll = 0;
  for (let level = 0; level < 256; level += 1) sumAll += level * histogram[level];
  let sumBackground = 0;
  let weightBackground = 0;
  let bestVariance = -1;
  let threshold = 165;
  for (let level = 0; level < 256; level += 1) {
    weightBackground += histogram[level];
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;
    sumBackground += level * histogram[level];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sumAll - sumBackground) / weightForeground;
    const betweenVariance =
      weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (betweenVariance > bestVariance) {
      bestVariance = betweenVariance;
      threshold = level;
    }
  }
  // 글자가 너무 많이 날아가지 않도록 최소/최대 범위를 둔다.
  return Math.min(200, Math.max(110, threshold + 8));
}

async function prepareOcrCanvas(image) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(2.2, Math.max(1, 2000 / Math.max(sourceWidth, 1)), 3200 / Math.max(sourceWidth, 1));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = width;
  colorCanvas.height = height;
  const colorContext = colorCanvas.getContext('2d');
  if (colorContext) {
    colorContext.fillStyle = '#ffffff';
    colorContext.fillRect(0, 0, width, height);
    colorContext.drawImage(image, 0, 0, width, height);
  }

  // OCR용: 색 띠(표지/상단·하단 배지)를 하얗게 지우고, 텍스트 줄의 굵은 검은 글씨만 남긴다.
  // 표지를 검게 이진화하면 OCR이 덩어리로 착각해 아래 제목을 못 읽기 때문이다.
  const ocrCanvas = document.createElement('canvas');
  ocrCanvas.width = width;
  ocrCanvas.height = height;
  const ocrContext = ocrCanvas.getContext('2d');
  if (ocrContext && colorContext) {
    ocrContext.fillStyle = '#ffffff';
    ocrContext.fillRect(0, 0, width, height);
    try {
      const shot = colorContext.getImageData(0, 0, width, height);
      const data = shot.data;

      // 줄 단위로 표지 여부 판단: 색이 다양하거나 어두운 픽셀이 많은 줄은 표지로 본다.
      const rowStep = 4;
      const photoRows = new Set();
      for (let y = 0; y < height; y += rowStep) {
        let colorCount = 0;
        let darkCount = 0;
        let sampled = 0;
        for (let x = 0; x < width; x += 10) {
          const index = (y * width + x) * 4;
          const r = data[index];
          const g = data[index + 1];
          const b = data[index + 2];
          const maxC = Math.max(r, g, b);
          const minC = Math.min(r, g, b);
          if (maxC - minC > 28) colorCount += 1;
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          if (lum < 100) darkCount += 1;
          sampled += 1;
        }
        if (sampled && (colorCount / sampled > 0.22 || darkCount / sampled > 0.55)) {
          for (let dy = 0; dy < rowStep; dy += 1) {
            if (y + dy < height) photoRows.add(y + dy);
          }
        }
      }

      const histogram = new Array(256).fill(0);
      for (let y = 0; y < height; y += 1) {
        if (photoRows.has(y)) continue;
        for (let x = 0; x < width; x += 1) {
          const index = (y * width + x) * 4;
          const lumValue = Math.round(0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]);
          histogram[Math.min(255, Math.max(0, lumValue))] += 1;
        }
      }
      const otsuThreshold = computeOtsuThreshold(histogram);

      for (let y = 0; y < height; y += 1) {
        const isPhoto = photoRows.has(y);
        for (let x = 0; x < width; x += 1) {
          const index = (y * width + x) * 4;
          if (isPhoto) {
            data[index] = 255;
            data[index + 1] = 255;
            data[index + 2] = 255;
            data[index + 3] = 255;
            continue;
          }
          const r = data[index];
          const g = data[index + 1];
          const b = data[index + 2];
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const keep = lum < otsuThreshold;
          const v = keep ? 0 : 255;
          data[index] = v;
          data[index + 1] = v;
          data[index + 2] = v;
          data[index + 3] = 255;
        }
      }
      ocrContext.putImageData(shot, 0, 0);
    } catch {
      ocrContext.drawImage(image, 0, 0, width, height);
    }
  }

  // 딱지 감지는 원본 색 canvas를 쓴다.
  ocrCanvas.__colorCanvas = colorCanvas;
  return ocrCanvas;
}

function isListLine(text) {
  // 독서플랜 목록 줄에는 카테고리(JK2 …/…)나 (숫자)가 항상 있다.
  // 표지 그림 속 글자는 이 표시가 없으므로 제목 목록에서 뺀다.
  const value = String(text || '');
  return /JK/i.test(value) || /\(\s*\d+\s*\)/.test(value) || /(그림책|과학|사회|한국문화|국내창작|외국창작)\s*\//.test(value);
}

function parseOcrItems(data, canvas) {
  const words = Array.isArray(data.words) ? data.words : [];
  const lines = groupOcrWords(words);
  const items = [];
  const seen = new Set();

  for (const line of lines) {
    if (!isListLine(line.text)) continue;
    const title = extractTitleFromLine(line.text);
    if (!title) continue;
    const key = title.replace(/[\s.,!?:;'"·~\-]/g, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const stickers = detectStickers(canvas.__colorCanvas || canvas, line);
    const bothRead = stickers.red && stickers.green;
    // 빨강+초록 둘 다인 경우만 제외
    const excludedByRed = stickers.red && stickers.green;
    items.push({
      title,
      checked: !excludedByRed,
      bothRead,
      red: stickers.red,
      green: stickers.green,
    });
  }

  // 단어 위치가 깨져 일부만 뽑힐 수도 있다. 원문 줄도 함께 합쳐 누락을 줄인다.
  // 원문에서만 찾은 제목은 딱지 정보가 없어 체크된 상태로 둔다.
  if (data && typeof data.text === 'string') {
    for (const rawLine of String(data.text).split(/\r?\n/)) {
      if (!isListLine(rawLine)) continue;
      const title = extractTitleFromLine(rawLine);
      if (!title) continue;
      const key = title.replace(/[\s.,!?:;'"·~\-]/g, '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ title, checked: true, bothRead: false, red: false, green: false });
    }
  }

  return items;
}

function mergeOcrItems(primary, extra) {
  const merged = [...primary];
  const seen = new Set(primary.map((item) => String(item.title).replace(/[\s.,!?:;'"·~\-]/g, '').toLowerCase()));
  for (const item of extra) {
    const key = String(item.title).replace(/[\s.,!?:;'"·~\-]/g, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

async function recognizeSliced(Tesseract, canvas) {
  const height = canvas.height;
  const slices = [];
  const band = Math.max(1, Math.floor(height * 0.34));
  for (let y = 0; y < height; y += Math.max(1, Math.floor(band / 2))) {
    const sliceHeight = Math.min(band, height - y);
    if (sliceHeight < Math.floor(height * 0.12)) break;
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = sliceHeight;
    const ctx = slice.getContext('2d');
    if (!ctx) continue;
    ctx.drawImage(canvas, 0, y, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
    slices.push(slice);
  }

  const combined = { text: '', words: [] };
  for (let sliceIndex = 0; sliceIndex < slices.length; sliceIndex += 1) {
    const slice = slices[sliceIndex];
    const yOffset = sliceIndex * Math.max(1, Math.floor(band / 2));
    const { data } = await Tesseract.recognize(slice, 'kor+eng', { tessedit_pageseg_mode: '6' });
    if (data && typeof data.text === 'string') combined.text += `${data.text}\n`;
    if (data && Array.isArray(data.words)) {
      for (const word of data.words) {
        if (!word || !word.bbox) continue;
        combined.words.push({
          ...word,
          bbox: {
            ...word.bbox,
            y0: (Number(word.bbox.y0) || 0) + yOffset,
            y1: (Number(word.bbox.y1) || 0) + yOffset,
          },
        });
      }
    }
  }
  return combined;
}

function groupOcrWords(words) {
  const usable = words
    .filter((word) => word && word.text && String(word.text).trim() && word.bbox)
    .map((word) => {
      const y0 = Number(word.bbox.y0) || 0;
      const y1 = Number(word.bbox.y1) || 0;
      return {
        text: String(word.text).trim(),
        x0: Number(word.bbox.x0) || 0,
        x1: Number(word.bbox.x1) || 0,
        y0,
        y1,
        yCenter: (y0 + y1) / 2,
        height: Math.max(1, y1 - y0),
        confidence: Number(word.confidence) || 0,
      };
    })
    .sort((a, b) => a.yCenter - b.yCenter || a.x0 - b.x0);

  const lines = [];
  for (const word of usable) {
    let target = null;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const candidate = lines[index];
      const tolerance = Math.max(10, candidate.medianHeight * 0.6);
      if (Math.abs(candidate.yCenter - word.yCenter) <= tolerance) {
        target = candidate;
        break;
      }
    }
    if (!target) {
      target = { words: [], yCenter: word.yCenter, medianHeight: word.height };
      lines.push(target);
    }
    target.words.push(word);
    target.yCenter = target.words.reduce((sum, item) => sum + item.yCenter, 0) / target.words.length;
    const heights = target.words.map((item) => item.height).sort((a, b) => a - b);
    target.medianHeight = heights[Math.floor(heights.length / 2)];
  }

  return lines
    .map((line) => {
      const sorted = [...line.words].sort((a, b) => a.x0 - b.x0);
      return {
        text: sorted.map((word) => word.text).join(' '),
        yCenter: line.yCenter,
        y0: Math.min(...line.words.map((word) => word.y0)),
        y1: Math.max(...line.words.map((word) => word.y1)),
        height: line.medianHeight,
        confidence: line.words.reduce((sum, word) => sum + word.confidence, 0) / line.words.length,
      };
    })
    .sort((a, b) => a.yCenter - b.yCenter);
}

function extractTitleFromLine(rawText) {
  let text = String(rawText || '').replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const jkIndex = text.toUpperCase().indexOf('JK');
  if (jkIndex >= 0) {
    const categoryMatch = text.slice(jkIndex).match(/^JK[^\s]*\s+\S+\/\S+\s+(.+)$/i);
    if (categoryMatch) {
      text = categoryMatch[1];
    } else {
      // 카테고리 형식이 깨졌으면 JK 뒤의 단어들을 버리고 뒤쪽을 쓴다.
      const parts = text.split(' ').filter(Boolean);
      const jkPart = parts.findIndex((part) => /^JK/i.test(part));
      if (jkPart >= 0) text = parts.slice(jkPart + 3).join(' ');
    }
  } else if (/(그림책|과학|사회|한국문화)/.test(text) && /\S\/\S/.test(text)) {
    // JK가 흐리게 읽힌 경우: 앞 카테고리 토큰 2개 정도만 빼고 제목으로 간주
    const parts = text.split(' ').filter(Boolean);
    const slashIndex = parts.findIndex((part) => /\//.test(part));
    if (slashIndex >= 0) text = parts.slice(slashIndex + 1).join(' ');
  } else {
    return null;
  }

  text = text.replace(/\(\d+\)/g, ' ');
  text = text.replace(/원서/g, ' ');
  text = text.replace(/[{}[\]()]/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  text = text.replace(/^[.,:;·"'""''`~\-\s]+|[.,:;·"'""''`~\-\s]+$/g, '').trim();

  if (!text) return null;
  if (!/[가-힣]/.test(text)) return null;
  if (/\(\d+\)/.test(text) && !/JK/i.test(rawText) && !/(그림책|과학|사회|한국문화)/.test(text)) {
    // "제목 (숫자)" 형태 줄은 JK가 깨져도 제목으로 간주한다 (숫자 앞부분만 뽑는다)
    const loose = text.replace(/\(\d+\)/g, ' ').replace(/원서/g, ' ').replace(/\s+/g, ' ').trim();
    if (loose && loose.length >= 2 && !/^(Weekly|PLAN|JAN|FEB|MAR|APR|MAY|JUN|MY|주차|5~7세)/i.test(loose)) {
      return cleanTitleTail(loose.replace(/^[.,:;·"'""''`~\-\s]+|[.,:;·"'""''`~\-\s]+$/g, '').trim()) || null;
    }
  }
  if (/^(Weekly|PLAN|JAN|FEB|MAR|APR|MAY|JUN|MY)\b/i.test(text)) return null;
  if (/^(주차|5~7세|포트폴리오|책별레|책나무|연산|잡수네)\s*$/.test(text)) return null;
  if (/^JK/i.test(text)) return null;
  if (/의\s*$/.test(text) && text.length < 3) return null;
  if (text.length < 2) return null;

  return cleanTitleTail(text);
}

function cleanTitleTail(value) {
  let text = String(value || '').replace(/\s+/g, ' ').trim();
  // OCR이 한 글자씩 띄어 읽은 경우(예: '달 라') 붙인다. 두 글자 이상 단어는 그대로 둔다.
  text = text
    .split(' ')
    .reduce((acc, part) => {
      const prev = acc[acc.length - 1];
      if (prev && /^[가-힣]$/.test(prev) && /^[가-힣]$/.test(part)) {
        acc[acc.length - 1] = prev + part;
      } else {
        acc.push(part);
      }
      return acc;
    }, [])
    .join(' ');
  for (let guard = 0; guard < 6; guard += 1) {
    const before = text;
    text = text.replace(/[.!?！？。…~·\-–—|\\/#@%^*+=_<>]+$/g, '').trim();
    text = text.replace(/["'’”)]+$/g, '').trim();
    if (text === before) break;
  }
  // 한글이 없는 맨 끝 토큰(영문/숫자/기호)은 꼬리로 보고 뺀다. 10가지처럼 한글이 붙은 건 유지한다.
  for (let guard = 0; guard < 8; guard += 1) {
    const parts = text.split(' ').filter(Boolean);
    if (parts.length <= 1) break;
    const last = parts[parts.length - 1];
    if (/[가-힣]/.test(last)) break;
    parts.pop();
    text = parts.join(' ');
  }
  // 앞쪽에 붙은 잡음 토큰도 제거 (한글 없는 첫 토큰)
  for (let guard = 0; guard < 4; guard += 1) {
    const parts = text.split(' ').filter(Boolean);
    if (parts.length <= 1) break;
    if (/[가-힣]/.test(parts[0])) break;
    parts.shift();
    text = parts.join(' ');
  }
  // 붙어 있는 꼬리도 뺀다: 달밤! / 달밤28 / 달밤ABC 같은 경우
  text = text.replace(/[A-Za-z!?！？…]+$/g, '').trim();
  text = text.replace(/\d+$/, '').trim();
  text = text.replace(/[\s.!?！？。…~·\-–—|:;,'"]+$/g, '').trim();
  text = text.replace(/^[\s.!?！？。…~·\-–—|:;,'"]+/g, '').trim();
  return text;
}

function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : delta / max;
  return { h, s, v: max };
}

function detectStickers(canvas, line) {
  try {
    const context = canvas.getContext('2d');
    if (!context || !canvas.width || !canvas.height) return { red: false, green: false, redRatio: 0, greenRatio: 0 };
    // 딱지는 오른쪽 끝, 줄의 실제 높이 안쪽에 붙는다.
    const lineTop = line.y0 !== undefined ? line.y0 : line.yCenter - 14;
    const lineBottom = line.y1 !== undefined ? line.y1 : line.yCenter + 14;
    const pad = Math.max(2, Math.round((lineBottom - lineTop) * 0.25));
    const x0 = Math.floor(canvas.width * 0.88);
    const x1 = Math.floor(canvas.width * 0.99);
    const y0 = Math.max(0, Math.floor(lineTop - pad));
    const y1 = Math.min(canvas.height, Math.ceil(lineBottom + pad));
    if (x1 <= x0 || y1 <= y0) return { red: false, green: false, redRatio: 0, greenRatio: 0 };

    const image = context.getImageData(x0, y0, x1 - x0, y1 - y0);
    let red = 0;
    let green = 0;
    let total = 0;
    for (let index = 0; index < image.data.length; index += 4) {
      const { h, s, v } = rgbToHsv(image.data[index], image.data[index + 1], image.data[index + 2]);
      total += 1;
      if (s > 0.45 && v > 0.4 && (h < 18 || h > 330)) red += 1;
      else if (s > 0.35 && v > 0.3 && h >= 70 && h <= 170) green += 1;
    }
    const redRatio = total ? red / total : 0;
    const greenRatio = total ? green / total : 0;
    // 딱지 한 개는 줄 높이의 대부분을 차지한다. 흩어진 색 점은 무시한다.
    return {
      red: redRatio >= 0.012,
      green: greenRatio >= 0.012,
      redRatio,
      greenRatio,
    };
  } catch {
    return { red: false, green: false, redRatio: 0, greenRatio: 0 };
  }
}

function renderOcrItems() {
  els.ocrList.innerHTML = state.ocrItems
    .map((item, index) => {
      const badge = item.bothRead
        ? `<button type="button" class="ocr-badge both" data-ocr-badge-index="${index}" title="딱지를 눌러 바꿀 수 있습니다" aria-label="딱지 상태 변경">🔴🟢 둘 다 읽음 · 제외</button>`
        : item.red
          ? `<button type="button" class="ocr-badge red" data-ocr-badge-index="${index}" title="딱지를 눌러 바꿀 수 있습니다" aria-label="딱지 상태 변경">🔴 첫째만</button>`
          : item.green
            ? `<button type="button" class="ocr-badge green" data-ocr-badge-index="${index}" title="딱지를 눌러 바꿀 수 있습니다" aria-label="딱지 상태 변경">🟢 둘째만</button>`
            : `<button type="button" class="ocr-badge none" data-ocr-badge-index="${index}" title="딱지를 눌러 바꿀 수 있습니다" aria-label="딱지 상태 변경">딱지 없음</button>`;
      return `<li class="ocr-item${item.bothRead ? ' is-both' : ''}">
        <input type="checkbox" data-ocr-index="${index}" ${item.checked ? 'checked' : ''} aria-label="${escapeAttr(item.title)} 포함 여부" />
        <input type="text" class="ocr-title" data-ocr-title-index="${index}" value="${escapeAttr(item.title)}" spellcheck="false" aria-label="책 제목 ${index + 1}" />
        ${badge}
      </li>`;
    })
    .join('');
  els.ocrResults.hidden = false;
  els.ocrCount.textContent = `${state.ocrItems.filter((item) => item.checked).length}권 체크됨 / ${state.ocrItems.length}권`;
}

function cycleOcrSticker(index) {
  const item = state.ocrItems[index];
  if (!item) return;
  // 입력란에 고친 제목을 먼저 상태에 반영한다.
  const titleInput = els.ocrList.querySelector(`[data-ocr-title-index="${index}"]`);
  if (titleInput && titleInput.value.trim()) item.title = titleInput.value.trim();

  // 없음 -> 빨강(첫째) -> 초록(둘째) -> 둘 다 -> 없음
  if (!item.red && !item.green) { item.red = true; item.green = false; }
  else if (item.red && !item.green) { item.red = false; item.green = true; }
  else if (!item.red && item.green) { item.red = true; item.green = true; }
  else { item.red = false; item.green = false; }
  item.bothRead = item.red && item.green;
  item.checked = !item.bothRead;
  renderOcrItems();
}

function addOcrTitle() {
  const title = (els.ocrAddInput.value || '').trim();
  if (!title) return;
  const clean = cleanTitleTail(title) || title;
  state.ocrItems.push({ title: clean, checked: true, bothRead: false, red: false, green: false });
  els.ocrAddInput.value = '';
  renderOcrItems();
  els.ocrCount.textContent = `${state.ocrItems.filter((item) => item.checked).length}권 체크됨 / ${state.ocrItems.length}권`;
}

function checkedOcrTitles() {
  const inputs = [...els.ocrList.querySelectorAll('[data-ocr-title-index]')];
  return state.ocrItems
    .map((item, index) => {
      const checkbox = els.ocrList.querySelector(`[data-ocr-index="${index}"]`);
      const titleInput = inputs.find((input) => Number(input.dataset.ocrTitleIndex) === index);
      const title = titleInput ? titleInput.value.trim() : item.title;
      return { title, checked: checkbox ? checkbox.checked : item.checked };
    })
    .filter((item) => item.checked && item.title)
    .map((item) => item.title);
}

function applyOcrTitles(searchNow, silent = false) {
  const titles = checkedOcrTitles();
  if (titles.length === 0) {
    if (!silent) showToast('체크한 제목이 없습니다.', 'warn');
    return;
  }

  const existing = parseQueries();
  const merged = [...existing];
  for (const title of titles) {
    if (!merged.some((query) => query.toLowerCase() === title.toLowerCase())) merged.push(title);
  }
  els.queryInput.value = merged.join('\n');
  updateQueryCount();
  savePrefs();
  if (!silent) showToast(`${titles.length}권 제목을 검색창에 넣었습니다.`);

  if (searchNow) startSearch();
}



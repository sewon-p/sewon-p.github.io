import type {
  DictionaryKanjiResult,
  DictionaryLookup,
  DictionaryResult,
  DictionarySenseResult,
  DictionaryWordResult,
} from './DictionaryPanel';

const JOTOBA_ENDPOINT = 'https://jotoba.de/api/search';
const CACHE_KEY = 'japanese-study:jotoba-cache:v2';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_LIMIT = 50;
const REQUEST_TIMEOUT_MS = 8_000;
const KANJI_PATTERN = /\p{Script=Han}/gu;
const kanjiLookupPromises = new Map<string, Promise<DictionaryKanjiResult>>();
const wordLookupPromises = new Map<string, Promise<DictionaryWordResult[]>>();

interface CacheEntry {
  query: string;
  savedAt: number;
  results: DictionaryResult[];
}

interface CacheStore {
  version: 1;
  entries: CacheEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(text).filter(Boolean))];
}

function posLabel(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!isRecord(value)) return '';
  return Object.entries(value)
    .map(([key, detail]) => {
      const suffix = text(detail);
      return suffix && suffix !== 'Normal' ? `${key} · ${suffix}` : key;
    })
    .filter(Boolean)
    .join(' · ');
}

function normalizeQuery(value: string): string {
  return value.normalize('NFKC').trim();
}

function queryKanji(value: string): string[] {
  return [...new Set(value.match(KANJI_PATTERN) ?? [])];
}

function isDictionaryResult(value: unknown): value is DictionaryResult {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== 'string'
    || value.origin !== 'lookup'
    || typeof value.dictionaryLabel !== 'string'
    || typeof value.meaningKo !== 'string'
    || !Array.isArray(value.examples)
  ) return false;
  const isTextList = (list: unknown): boolean =>
    Array.isArray(list) && list.every((item) => typeof item === 'string');
  if (value.kind === 'kanji') {
    return typeof value.literal === 'string'
      && isTextList(value.onReadings)
      && isTextList(value.kunReadings)
      && isTextList(value.nanoriReadings)
      && isTextList(value.koreanReadings)
      && isTextList(value.meaningsEn)
      && Array.isArray(value.targets);
  }
  return value.kind === 'word'
    && typeof value.headword === 'string'
    && isTextList(value.forms)
    && isTextList(value.readings)
    && Array.isArray(value.senses)
    && value.senses.every((sense) => isRecord(sense)
      && typeof sense.id === 'string'
      && typeof sense.meaningKo === 'string'
      && isTextList(sense.partsOfSpeech)
      && isTextList(sense.glossesEn));
}

function readCache(): CacheEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.entries)) return [];
    const now = Date.now();
    return parsed.entries.filter((entry): entry is CacheEntry => {
      if (!isRecord(entry) || typeof entry.savedAt !== 'number') return false;
      return typeof entry.query === 'string'
        && Array.isArray(entry.results)
        && entry.results.every(isDictionaryResult)
        && entry.savedAt <= now
        && now - entry.savedAt < CACHE_TTL_MS;
    });
  } catch {
    return [];
  }
}

function writeCache(entries: CacheEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: CacheStore = {
      version: 1,
      entries: entries.slice(0, CACHE_LIMIT),
    };
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // A live lookup still works when browser storage is unavailable.
  }
}

function cachedResult(query: string): DictionaryResult[] | null {
  const entries = readCache();
  const match = entries.find((entry) => entry.query === query);
  if (!match) return null;
  writeCache([match, ...entries.filter((entry) => entry.query !== query)]);
  return match.results;
}

function saveResult(query: string, results: DictionaryResult[]): void {
  const entries = readCache().filter((entry) => entry.query !== query);
  writeCache([{ query, savedAt: Date.now(), results }, ...entries]);
}

function wordMatchScore(word: DictionaryWordResult, query: string): number {
  const forms = word.forms.map(normalizeQuery);
  const readings = word.readings.map(normalizeQuery);
  if (forms.includes(query)) return 1_000;
  if (readings.includes(query)) return 950;
  if (forms.some((form) => form.startsWith(query))) return 800;
  if (forms.some((form) => form.includes(query))) return 700;
  return 100;
}

function parseSense(value: unknown, wordIndex: number, senseIndex: number): DictionarySenseResult | null {
  if (!isRecord(value)) return null;
  const language = text(value.language);
  if (language && language !== 'English') return null;
  const glossesEn = textList(value.glosses);
  if (!glossesEn.length) return null;
  const partsOfSpeech = Array.isArray(value.pos)
    ? value.pos.map(posLabel).filter(Boolean)
    : [];
  return {
    id: `jotoba-word-${wordIndex}-sense-${senseIndex}`,
    partsOfSpeech,
    glossesEn,
    meaningKo: '',
  };
}

function parseWord(value: unknown, index: number): DictionaryWordResult | null {
  if (!isRecord(value) || !isRecord(value.reading)) return null;
  const kanji = text(value.reading.kanji);
  const kana = text(value.reading.kana);
  const headword = kanji || kana;
  if (!headword) return null;
  const senses = Array.isArray(value.senses)
    ? value.senses
        .map((sense, senseIndex) => parseSense(sense, index, senseIndex))
        .filter((sense): sense is DictionarySenseResult => Boolean(sense))
    : [];
  return {
    id: `jotoba-word-${index}-${encodeURIComponent(`${headword}-${kana}`)}`,
    kind: 'word',
    origin: 'lookup',
    dictionaryLabel: 'Jotoba · JMdict',
    meaningKo: '',
    examples: [],
    headword,
    forms: [headword],
    readings: kana ? [kana] : [],
    senses,
    furigana: text(value.reading.furigana),
    common: value.common === true,
  };
}

function parseKanji(value: unknown, index: number): DictionaryKanjiResult | null {
  if (!isRecord(value)) return null;
  const literal = text(value.literal);
  if (!literal) return null;
  return {
    id: `jotoba-kanji-${index}-${literal}`,
    kind: 'kanji',
    origin: 'lookup',
    dictionaryLabel: 'Jotoba · KANJIDIC2',
    meaningKo: '',
    examples: [],
    literal,
    onReadings: textList(value.onyomi),
    kunReadings: textList(value.kunyomi),
    nanoriReadings: [],
    koreanReadings: textList(value.korean_h),
    meaningsEn: textList(value.meanings),
    grade: numberValue(value.grade),
    frequency: numberValue(value.frequency),
    strokeCount: numberValue(value.stroke_count),
    targets: [],
  };
}

function parseResponse(payload: unknown, query: string): DictionaryResult[] {
  if (!isRecord(payload)) return [];
  const kanjiSet = new Set(queryKanji(query));
  const kanjiResults = Array.isArray(payload.kanji)
    ? payload.kanji
        .map(parseKanji)
        .filter((result): result is DictionaryKanjiResult => {
          if (!result) return false;
          return kanjiSet.has(result.literal);
        })
    : [];
  const wordResults = Array.isArray(payload.words)
    ? payload.words
        .map(parseWord)
        .filter((result): result is DictionaryWordResult => Boolean(result))
        .sort((left, right) => wordMatchScore(right, query) - wordMatchScore(left, query))
        .slice(0, 6)
    : [];

  return [...query].length === 1 && kanjiSet.size === 1
    ? [...kanjiResults, ...wordResults]
    : [...wordResults, ...kanjiResults];
}

async function requestJotoba(
  kind: 'words' | 'kanji',
  term: string,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${JOTOBA_ENDPOINT}/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    signal,
    body: JSON.stringify({ query: term, language: 'English', no_english: false }),
  });
  if (!response.ok) throw new Error(`사전 서버 응답 ${response.status}`);
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload[kind])) {
    throw new Error('사전 응답을 읽지 못했습니다. 다시 검색해 주세요.');
  }
  return payload;
}

export async function lookupJotobaKanji(rawLiteral: string): Promise<DictionaryKanjiResult> {
  const literal = normalizeQuery(rawLiteral);
  if ([...literal].length !== 1 || queryKanji(literal)[0] !== literal) {
    throw new Error('한자 한 글자만 조회할 수 있습니다.');
  }
  const pending = kanjiLookupPromises.get(literal);
  if (pending) return pending;

  const lookup = (async (): Promise<DictionaryKanjiResult> => {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const payload = await requestJotoba('kanji', literal, controller.signal);
      const result = (payload.kanji as unknown[])
        .map(parseKanji)
        .find((candidate) => candidate?.literal === literal);
      if (!result) throw new Error(`${literal}의 KANJIDIC2 항목을 찾지 못했습니다.`);
      return result;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('사전 응답 시간이 길어 조회를 중단했습니다.', { cause: error });
      }
      throw error;
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  })();
  kanjiLookupPromises.set(literal, lookup);
  try {
    return await lookup;
  } catch (error) {
    kanjiLookupPromises.delete(literal);
    throw error;
  }
}

export async function lookupJotobaWords(rawQuery: string): Promise<DictionaryWordResult[]> {
  const query = normalizeQuery(rawQuery);
  if (!query || [...query].length > 80) throw new Error('단어 검색어가 올바르지 않습니다.');
  const pending = wordLookupPromises.get(query);
  if (pending) return pending;

  const lookup = (async (): Promise<DictionaryWordResult[]> => {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const payload = await requestJotoba('words', query, controller.signal);
      return (payload.words as unknown[])
        .map(parseWord)
        .filter((candidate): candidate is DictionaryWordResult => Boolean(candidate));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('사전 응답 시간이 길어 조회를 중단했습니다.', { cause: error });
      }
      throw error;
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  })();
  wordLookupPromises.set(query, lookup);
  try {
    return await lookup;
  } catch (error) {
    wordLookupPromises.delete(query);
    throw error;
  }
}

export const lookupJotoba: DictionaryLookup = async (rawQuery) => {
  const query = normalizeQuery(rawQuery);
  if (!query) return [];
  if ([...query].length > 80) {
    throw new Error('단어나 한자 중심으로 80자 이내로 검색해 주세요.');
  }
  const cached = cachedResult(query);
  if (cached) return cached;

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const kanji = queryKanji(query).join('');
    // A word lookup can return alternate spellings and omit the queried kanji.
    // The dedicated kanji endpoint keeps single-character searches reliable.
    const [wordsPayload, kanjiPayload] = await Promise.all([
      requestJotoba('words', query, controller.signal),
      kanji ? requestJotoba('kanji', kanji, controller.signal) : Promise.resolve(null),
    ]);
    const results = parseResponse({
      words: wordsPayload.words,
      kanji: kanjiPayload?.kanji ?? [],
    }, query);
    if (results.length) saveResult(query, results);
    return results;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('사전 응답 시간이 길어 조회를 중단했습니다.', { cause: error });
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
};

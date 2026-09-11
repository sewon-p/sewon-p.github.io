import type {
  KanjiArticleTarget,
  KanjiExampleWord,
  KanjiLexicalData,
} from './model';

export const KANJI_CARD_PIPELINE_VERSION = 'kanji-card/v2';
export const KANJI_DICTIONARY_VERSION = 'Jotoba API · KANJIDIC2';

export interface KanjiDictionarySnapshot {
  literal: string;
  onReadings: string[];
  kunReadings: string[];
  nanoriReadings: string[];
  koreanReadings: string[];
  meaningsEn: string[];
  grade?: number;
  frequency?: number;
  strokeCount?: number;
}

export interface KanjiTargetInput {
  word: string;
  wordReading: string;
  characterReading: string;
  meaningKoInContext: string;
  articleId: string | null;
  annotationId?: string;
}

export interface KanjiCardInput {
  literal: string;
  meaningKo: string;
  existingLexicalData?: KanjiLexicalData | null;
  targets: KanjiTargetInput[];
  exampleWords?: KanjiExampleWord[];
}

export interface KanjiExampleCandidate {
  word: string;
  wordReading: string;
  furigana: string;
  common: boolean;
  sourceIndex: number;
}

const VOICING_EQUIVALENTS: Record<string, string> = {
  が: 'か', ぎ: 'き', ぐ: 'く', げ: 'け', ご: 'こ',
  ざ: 'さ', じ: 'し', ず: 'す', ぜ: 'せ', ぞ: 'そ',
  だ: 'た', ぢ: 'ち', づ: 'つ', で: 'て', ど: 'と',
  ば: 'は', び: 'ひ', ぶ: 'ふ', べ: 'へ', ぼ: 'ほ',
  ぱ: 'は', ぴ: 'ひ', ぷ: 'ふ', ぺ: 'へ', ぽ: 'ほ',
};

function uniqueText(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.normalize('NFKC').trim() ?? '').filter(Boolean))];
}

function toHiragana(value: string): string {
  return value.normalize('NFKC').replace(/[ァ-ヶ]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0x60));
}

export function characterReadingFromFurigana(
  literal: string,
  furigana: string,
): string | null {
  const readings: string[] = [];
  for (const match of furigana.matchAll(/\[([^\]|]+)\|([^\]]+)\]/g)) {
    const characters = [...match[1]];
    const ruby = match[2].split('|');
    if (characters.length !== ruby.length) continue;
    characters.forEach((character, index) => {
      if (character === literal && ruby[index]?.trim()) readings.push(toHiragana(ruby[index].trim()));
    });
  }
  const unique = uniqueText(readings);
  return unique.length === 1 ? unique[0] : null;
}

function articleCandidateRank(
  articleWord: string,
  articleWordReading: string,
  candidate: KanjiExampleCandidate,
): number[] {
  const candidateWord = candidate.word.normalize('NFKC').trim();
  const candidateReading = toHiragana(candidate.wordReading.trim());
  const relation = candidateWord === articleWord
    ? candidateReading === articleWordReading ? 3 : 0
    : candidateReading === articleWordReading
      ? 2
      : articleWord.includes(candidateWord) && articleWordReading.includes(candidateReading)
        ? 1
        : 0;
  return [
    relation,
    relation === 1 ? [...candidateWord].length : 0,
    candidate.common ? 1 : 0,
  ];
}

function sameRank(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizedDictionaryReading(value: string): string {
  return toHiragana(value).replace(/^[－-]/, '').replaceAll('.', '');
}

function dictionaryReadingStem(value: string): string {
  return toHiragana(value).replace(/^[－-]/, '').split('.')[0];
}

function normalizeSoundChange(value: string): string {
  const reading = toHiragana(value).replaceAll('.', '').replace(/^[－-]/, '');
  if (!reading) return reading;
  const first = VOICING_EQUIVALENTS[reading[0]] ?? reading[0];
  return `${first}${reading.slice(1)}`.replace(/[くちつっ]$/, 'っ');
}

function matchesReading(reading: string, dictionaryReading: string): boolean {
  const target = toHiragana(reading);
  return target === normalizedDictionaryReading(dictionaryReading)
    || target === dictionaryReadingStem(dictionaryReading);
}

function matchesSoundChange(reading: string, dictionaryReading: string): boolean {
  const target = normalizeSoundChange(reading);
  return target === normalizeSoundChange(normalizedDictionaryReading(dictionaryReading))
    || target === normalizeSoundChange(dictionaryReadingStem(dictionaryReading));
}

export function isKanjiSurfaceReadingCompatible(
  baseReading: string,
  surfaceReading: string,
  dictionary: Pick<KanjiDictionarySnapshot, 'onReadings' | 'kunReadings' | 'nanoriReadings'>,
): boolean {
  const dictionaryReadings = [
    ...dictionary.onReadings,
    ...dictionary.kunReadings,
    ...dictionary.nanoriReadings,
  ];
  return dictionaryReadings.some((candidate) =>
    matchesReading(baseReading, candidate)
    && (
      matchesReading(surfaceReading, candidate)
      || matchesSoundChange(surfaceReading, candidate)
    ));
}

export function deriveKanjiArticleReading(
  literal: string,
  baseReading: string,
  articleWord: string,
  articleWordReading: string,
  dictionary: KanjiDictionarySnapshot,
  candidates: KanjiExampleCandidate[],
): string | null {
  const normalizedWord = articleWord.normalize('NFKC').trim();
  const normalizedWordReading = toHiragana(articleWordReading.trim());
  const exactCandidates = candidates.filter((candidate) =>
    candidate.word.normalize('NFKC').trim() === normalizedWord);
  if (
    exactCandidates.length
    && !exactCandidates.some((candidate) =>
      toHiragana(candidate.wordReading.trim()) === normalizedWordReading)
  ) return null;
  const matches = candidates
    .map((candidate) => {
      const candidateWord = candidate.word.normalize('NFKC').trim();
      if (!candidateWord.includes(literal)) return null;
      const characterReading = characterReadingFromFurigana(literal, candidate.furigana);
      if (
        !characterReading
        || !isKanjiSurfaceReadingCompatible(baseReading, characterReading, dictionary)
      ) return null;
      const rank = articleCandidateRank(normalizedWord, normalizedWordReading, candidate);
      if (rank[0] === 0) return null;
      return { characterReading, candidate, rank };
    })
    .filter((match): match is NonNullable<typeof match> => Boolean(match))
    .sort((left, right) => {
      for (let index = 0; index < left.rank.length; index += 1) {
        if (left.rank[index] !== right.rank[index]) return right.rank[index] - left.rank[index];
      }
      if (left.candidate.sourceIndex !== right.candidate.sourceIndex) {
        return left.candidate.sourceIndex - right.candidate.sourceIndex;
      }
      return left.candidate.word.localeCompare(right.candidate.word, 'ja');
    });
  if (matches.length) {
    const topReadings = uniqueText(
      matches
        .filter((match) => sameRank(match.rank, matches[0].rank))
        .map((match) => match.characterReading),
    );
    return topReadings.length === 1 ? topReadings[0] : null;
  }

  for (const kunReading of dictionary.kunReadings) {
    const [stem, suffix = ''] = toHiragana(kunReading)
      .replace(/^[－-]/, '')
      .split('.');
    if (
      stem
      && suffix
      && normalizedWord === `${literal}${suffix}`
      && normalizedWordReading === `${stem}${suffix}`
      && isKanjiSurfaceReadingCompatible(baseReading, stem, dictionary)
    ) return stem;
  }
  return null;
}

export function classifyKanjiReading(
  reading: string,
  dictionary: Pick<KanjiDictionarySnapshot, 'onReadings' | 'kunReadings' | 'nanoriReadings'>,
): NonNullable<KanjiArticleTarget['readingType']> {
  if (dictionary.onReadings.some((candidate) => matchesReading(reading, candidate))) return 'on';
  if (dictionary.kunReadings.some((candidate) => matchesReading(reading, candidate))) return 'kun';
  if (dictionary.nanoriReadings.some((candidate) => matchesReading(reading, candidate))) {
    return 'nanori';
  }
  if (
    [...dictionary.onReadings, ...dictionary.kunReadings, ...dictionary.nanoriReadings]
      .some((candidate) => matchesSoundChange(reading, candidate))
  ) return 'sound_change';
  return 'other';
}

export function selectKanjiExampleWords(
  literal: string,
  targetReading: string,
  dictionary: KanjiDictionarySnapshot,
  articleWords: string[],
  candidates: KanjiExampleCandidate[],
  limit = 1,
): KanjiExampleWord[] {
  const targetType = classifyKanjiReading(targetReading, dictionary);
  return candidates
    .map((candidate): (KanjiExampleWord & { score: number[] }) | null => {
      const characterReading = characterReadingFromFurigana(literal, candidate.furigana);
      if (!characterReading || !candidate.word.includes(literal)) return null;
      const readingType = classifyKanjiReading(characterReading, dictionary);
      const kanjiCount = candidate.word.match(/\p{Script=Han}/gu)?.length ?? 0;
      const overlapsArticle = articleWords.some((word) =>
        candidate.word === word
        || (
          word !== literal
          && (word.includes(candidate.word) || candidate.word.includes(word))
        ));
      if (overlapsArticle || candidate.word === literal || readingType === 'other') return null;
      return {
        word: candidate.word.normalize('NFKC').trim(),
        wordReading: toHiragana(candidate.wordReading.trim()),
        characterReading,
        readingType,
        score: [
          readingType === targetType ? 1 : 0,
          candidate.common ? 1 : 0,
          kanjiCount === 2 ? 1 : 0,
          -[...candidate.word].length,
          -candidate.sourceIndex,
        ],
      };
    })
    .filter((candidate): candidate is KanjiExampleWord & { score: number[] } => Boolean(candidate))
    .sort((left, right) => {
      for (let index = 0; index < left.score.length; index += 1) {
        if (left.score[index] !== right.score[index]) return right.score[index] - left.score[index];
      }
      return left.word.localeCompare(right.word, 'ja');
    })
    .filter((candidate, index, all) =>
      all.findIndex((item) =>
        item.word === candidate.word && item.wordReading === candidate.wordReading) === index)
    .slice(0, Math.max(0, limit))
    .map((candidate) => ({
      word: candidate.word,
      wordReading: candidate.wordReading,
      characterReading: candidate.characterReading,
      readingType: candidate.readingType,
    }));
}

function normalizedTarget(
  target: KanjiTargetInput | KanjiArticleTarget,
  dictionary: KanjiDictionarySnapshot,
): KanjiArticleTarget {
  const word = target.word.normalize('NFKC').trim();
  const wordReading = toHiragana(target.wordReading.trim());
  const characterReading = toHiragana(target.characterReading.trim());
  const meaningKoInContext = target.meaningKoInContext.normalize('NFKC').trim();
  if (!word || !word.includes(dictionary.literal)) {
    throw new Error(`${dictionary.literal} 한자 카드의 기사 단어가 올바르지 않습니다.`);
  }
  if (!wordReading || !characterReading) {
    throw new Error(`${dictionary.literal} 한자 카드의 기사 읽기가 비어 있습니다.`);
  }
  if (!meaningKoInContext) {
    throw new Error(`${dictionary.literal} 한자 카드의 문맥 뜻이 비어 있습니다.`);
  }
  return {
    word,
    wordReading,
    characterReading,
    readingType: classifyKanjiReading(characterReading, dictionary),
    meaningKoInContext,
    articleId: target.articleId,
    ...(target.annotationId ? { annotationId: target.annotationId } : {}),
  };
}

function normalizeExampleWords(
  values: KanjiExampleWord[],
  dictionary: KanjiDictionarySnapshot,
): KanjiExampleWord[] {
  const result: KanjiExampleWord[] = [];
  const seen = new Set<string>();
  values.forEach((value) => {
    const word = value.word.normalize('NFKC').trim();
    const wordReading = toHiragana(value.wordReading.trim());
    const characterReading = toHiragana(value.characterReading.trim());
    if (!word.includes(dictionary.literal) || !wordReading || !characterReading) {
      throw new Error(`${dictionary.literal} 한자 카드의 대표 단어가 올바르지 않습니다.`);
    }
    const readingType = classifyKanjiReading(characterReading, dictionary);
    if (readingType === 'other') {
      throw new Error(`${dictionary.literal} 한자 카드의 대표 단어 읽기가 사전과 맞지 않습니다.`);
    }
    const key = `${word}|${wordReading}|${characterReading}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ word, wordReading, characterReading, readingType });
  });
  return result;
}

function targetKey(target: KanjiArticleTarget): string {
  return [
    target.articleId ?? '',
    target.annotationId ?? '',
    target.word,
    target.wordReading,
  ].join('|');
}

function mergeTargets(
  existing: KanjiArticleTarget[],
  incoming: KanjiTargetInput[],
  dictionary: KanjiDictionarySnapshot,
): KanjiArticleTarget[] {
  const result = new Map<string, KanjiArticleTarget>();
  existing.forEach((target) => {
    const normalized = normalizedTarget(target, dictionary);
    if (normalized.readingType === 'other') return;
    result.set(targetKey(normalized), normalized);
  });
  incoming.forEach((target) => {
    const normalized = normalizedTarget(target, dictionary);
    const key = targetKey(normalized);
    result.set(key, normalized);
  });
  if (!result.size) {
    throw new Error(`${dictionary.literal} 한자 카드에 연결된 기사 단어가 없습니다.`);
  }
  return [...result.values()];
}

export function hasCompleteKanjiDictionaryData(
  value: KanjiLexicalData | null | undefined,
  literal: string,
  cardReading?: string,
): value is KanjiLexicalData {
  return Boolean(
    hasKanjiDictionaryBase(value, literal)
    && value.pipelineVersion === KANJI_CARD_PIPELINE_VERSION
    && value.schemaVersion === 1
    && (
      !cardReading
      || classifyKanjiReading(cardReading, value) !== 'other'
    )
    && Array.isArray(value.exampleWords)
    && value.exampleWords.length > 0
    && value.articleTargets.every((target) => {
      const classified = classifyKanjiReading(target.characterReading, value);
      return classified !== 'other'
        && target.readingType === classified
        && (
          !cardReading
          || isKanjiSurfaceReadingCompatible(cardReading, target.characterReading, value)
        );
    })
    && value.exampleWords.every((example) =>
      typeof example.word === 'string'
      && example.word.includes(literal)
      && typeof example.wordReading === 'string'
      && Boolean(example.wordReading.trim())
      && typeof example.characterReading === 'string'
      && Boolean(example.characterReading.trim())
      && example.readingType !== 'other'
      && example.readingType === classifyKanjiReading(example.characterReading, value)),
  );
}

export function hasDisplayableKanjiDictionaryData(
  value: KanjiLexicalData | null | undefined,
  literal: string,
  cardReading?: string,
): value is KanjiLexicalData {
  return Boolean(
    hasKanjiDictionaryBase(value, literal)
    && (
      !value.pipelineVersion
      || hasCompleteKanjiDictionaryData(value, literal, cardReading)
    ),
  );
}

function hasKanjiDictionaryBase(
  value: KanjiLexicalData | null | undefined,
  literal: string,
): value is KanjiLexicalData {
  return Boolean(
    value
    && value.kind === 'kanji'
    && value.literal === literal
    && value.dictionaryRef?.source === 'kanjidic2'
    && value.dictionaryRef.entryId === literal
    && Array.isArray(value.onReadings)
    && Array.isArray(value.kunReadings)
    && Array.isArray(value.nanoriReadings)
    && Array.isArray(value.meaningsEn)
    && value.meaningsEn.length > 0
    && Array.isArray(value.meaningsKo)
    && value.meaningsKo.some((meaning) => typeof meaning === 'string' && Boolean(meaning.trim()))
    && Array.isArray(value.articleTargets)
    && value.articleTargets.length > 0
    && value.articleTargets.every((target) =>
      typeof target.word === 'string'
      && target.word.includes(literal)
      && typeof target.wordReading === 'string'
      && Boolean(target.wordReading.trim())
      && typeof target.characterReading === 'string'
      && Boolean(target.characterReading.trim())
      && typeof target.meaningKoInContext === 'string'
      && Boolean(target.meaningKoInContext.trim()))
    && (value.onReadings.length > 0 || value.kunReadings.length > 0),
  );
}

export function dictionarySnapshotFromLexicalData(
  lexical: KanjiLexicalData,
): KanjiDictionarySnapshot {
  return {
    literal: lexical.literal,
    onReadings: lexical.onReadings,
    kunReadings: lexical.kunReadings,
    nanoriReadings: lexical.nanoriReadings,
    koreanReadings: lexical.koreanReadings ?? [],
    meaningsEn: lexical.meaningsEn,
    grade: lexical.grade,
    frequency: lexical.frequency,
    strokeCount: lexical.strokeCount,
  };
}

export function buildKanjiLexicalData(
  card: KanjiCardInput,
  dictionary: KanjiDictionarySnapshot,
): KanjiLexicalData {
  const literal = card.literal.normalize('NFKC').trim();
  if ([...literal].length !== 1 || dictionary.literal !== literal) {
    throw new Error(`한자 카드와 사전 표기가 일치하지 않습니다: ${literal || '(빈칸)'}`);
  }
  const existing = card.existingLexicalData;
  const articleTargets = mergeTargets(existing?.articleTargets ?? [], card.targets, dictionary);
  const existingMeaningsKo = uniqueText(existing?.meaningsKo ?? []);
  const cardMeaningsKo = uniqueText([card.meaningKo]);
  const meaningsKo = existingMeaningsKo.length
    ? existingMeaningsKo
    : cardMeaningsKo.length
      ? cardMeaningsKo
      : uniqueText(articleTargets.map((target) => target.meaningKoInContext));
  const exampleWords = normalizeExampleWords(
    card.exampleWords ?? existing?.exampleWords ?? [],
    dictionary,
  );
  return {
    kind: 'kanji',
    schemaVersion: 1,
    pipelineVersion: KANJI_CARD_PIPELINE_VERSION,
    dictionaryRef: existing?.dictionaryRef?.source === 'kanjidic2'
      ? existing.dictionaryRef
      : {
          source: 'kanjidic2',
          entryId: literal,
          sourceVersion: KANJI_DICTIONARY_VERSION,
        },
    literal,
    onReadings: uniqueText(dictionary.onReadings),
    kunReadings: uniqueText(dictionary.kunReadings),
    nanoriReadings: uniqueText(dictionary.nanoriReadings),
    koreanReadings: uniqueText(dictionary.koreanReadings),
    meaningsEn: uniqueText(dictionary.meaningsEn),
    meaningsKo,
    ...(dictionary.grade ? { grade: dictionary.grade } : {}),
    ...(dictionary.frequency ? { frequency: dictionary.frequency } : {}),
    ...(dictionary.strokeCount ? { strokeCount: dictionary.strokeCount } : {}),
    articleTargets,
    exampleWords,
  };
}

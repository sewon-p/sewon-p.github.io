import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactElement,
} from 'react';
import type {
  CardLexicalData,
  DictionaryReference,
  LearningCard,
  StudyArticle,
  StudyWorkspace,
  WordSenseSnapshot,
} from './model';

export interface DictionaryExampleResult {
  textJa: string;
  sourceLabel: string;
  articleId?: string | null;
}

export interface DictionarySenseResult extends WordSenseSnapshot {
  selected?: boolean;
}

interface DictionaryResultBase {
  id: string;
  origin: 'workspace' | 'lookup';
  dictionaryLabel: string;
  meaningKo: string;
  examples: DictionaryExampleResult[];
}

export interface DictionaryWordResult extends DictionaryResultBase {
  kind: 'word';
  headword: string;
  forms: string[];
  readings: string[];
  senses: DictionarySenseResult[];
  furigana?: string;
  common?: boolean;
}

export interface DictionaryKanjiTargetResult {
  word: string;
  wordReading: string;
  characterReading: string;
  meaningKoInContext: string;
  articleId?: string | null;
}

export interface DictionaryKanjiResult extends DictionaryResultBase {
  kind: 'kanji';
  literal: string;
  onReadings: string[];
  kunReadings: string[];
  nanoriReadings: string[];
  koreanReadings: string[];
  meaningsEn: string[];
  grade?: number;
  frequency?: number;
  strokeCount?: number;
  targets: DictionaryKanjiTargetResult[];
}

export type DictionaryResult = DictionaryWordResult | DictionaryKanjiResult;
export type DictionaryLookup = (query: string) => Promise<DictionaryResult[]>;

export interface DictionaryPanelProps {
  workspace: Pick<StudyWorkspace, 'cards' | 'articles'>;
  activeArticleId?: string | null;
  lookup?: DictionaryLookup;
  initialQuery?: string;
  query?: string;
  onQueryChange?: (query: string) => void;
  maxResults?: number;
  autoFocus?: boolean;
  floating?: boolean;
  className?: string;
}

type LookupStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';

const styles = {
  panel: {
    marginTop: 'var(--xl)',
    borderTop: '1px solid var(--ink)',
    color: 'var(--ink)',
  },
  floatingPanel: {
    color: 'var(--ink)',
  },
  header: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 'var(--sm)',
    padding: 'var(--md) 0 var(--sm)',
  },
  kicker: {
    color: 'var(--tint)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-small)',
    fontWeight: 'var(--weight-ui)',
  },
  heading: {
    marginTop: '4px',
    fontSize: 'var(--text-h3)',
    fontWeight: 'var(--weight-headline)',
    lineHeight: 'var(--lh-h3)',
    letterSpacing: 'var(--tracking-h3)',
  },
  inventory: {
    color: 'var(--mute)',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    whiteSpace: 'nowrap',
  },
  form: {
    padding: 'var(--sm) 0 var(--md)',
    borderBottom: '1px solid var(--hairline)',
  },
  label: {
    display: 'block',
    marginBottom: 'var(--xs)',
    color: 'var(--mute)',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    fontWeight: 'var(--weight-ui)',
  },
  searchRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--xs)',
  },
  input: {
    flex: '1 1 240px',
    minWidth: 0,
    minHeight: '48px',
    padding: '0 var(--sm)',
    fontFamily: 'var(--study-japanese)',
    fontSize: '18px',
  },
  button: {
    minWidth: '88px',
    minHeight: '48px',
    padding: '0 var(--md)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--ink)',
    color: 'var(--paper)',
    fontWeight: 'var(--weight-ui)',
  },
  hint: {
    display: 'block',
    marginTop: 'var(--xs)',
    color: 'var(--mute)',
    fontSize: 'var(--text-small)',
    lineHeight: 'var(--lh-small)',
  },
  state: {
    padding: 'var(--md) 0',
    borderBottom: '1px solid var(--hairline)',
    color: 'var(--mute)',
    fontSize: 'var(--text-small)',
    lineHeight: 'var(--lh-small)',
  },
  error: {
    padding: 'var(--sm) 0',
    borderBottom: '1px solid var(--hairline)',
    color: 'var(--study-red)',
    fontSize: 'var(--text-small)',
    lineHeight: 'var(--lh-small)',
  },
  resultSummary: {
    color: 'var(--mute)',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
  },
  resultSummaryRow: {
    minHeight: '52px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--sm)',
    borderBottom: '1px solid var(--hairline)',
  },
  collapseButton: {
    minHeight: '36px',
    padding: '0 var(--xs)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--mute)',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: 'var(--weight-ui)',
  },
  resultViewport: {
    maxHeight: 'min(68vh, 720px)',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    scrollbarGutter: 'stable',
  },
  result: {
    padding: 'var(--md) 0',
    borderBottom: '1px solid var(--hairline)',
  },
  resultHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 'var(--sm)',
  },
  headword: {
    fontFamily: 'var(--study-japanese)',
    fontSize: '28px',
    fontWeight: 'var(--weight-headline)',
    lineHeight: '36px',
    letterSpacing: 'var(--tracking-tight)',
  },
  type: {
    flex: '0 0 auto',
    padding: '2px var(--xs)',
    border: '1px solid var(--hairline)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--mute)',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: 'var(--weight-ui)',
  },
  reading: {
    marginTop: '4px',
    fontFamily: 'var(--study-japanese)',
    fontSize: '16px',
    lineHeight: '24px',
  },
  meaning: {
    marginTop: 'var(--xs)',
    fontWeight: 'var(--weight-ui)',
    lineHeight: 'var(--lh-body)',
  },
  meaningLabel: {
    display: 'block',
    marginTop: 'var(--sm)',
    color: 'var(--mute)',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: 'var(--weight-ui)',
  },
  facts: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 'var(--xs) var(--sm)',
    marginTop: 'var(--sm)',
    padding: 'var(--sm) 0',
    borderTop: '1px dashed var(--hairline)',
    borderBottom: '1px dashed var(--hairline)',
  },
  fact: {
    minWidth: 0,
  },
  term: {
    color: 'var(--mute)',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
  },
  definition: {
    marginTop: '2px',
    overflowWrap: 'anywhere',
    fontFamily: 'var(--study-japanese)',
    fontSize: 'var(--text-small)',
    lineHeight: 'var(--lh-small)',
  },
  section: {
    marginTop: 'var(--sm)',
  },
  sectionTitle: {
    color: 'var(--mute)',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: 'var(--weight-ui)',
  },
  list: {
    marginTop: 'var(--xs)',
    borderTop: '1px solid var(--hairline)',
  },
  listItem: {
    padding: 'var(--xs) 0',
    borderBottom: '1px solid var(--hairline)',
  },
  senseTopline: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: '4px var(--xs)',
  },
  senseNumber: {
    color: 'var(--tint)',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: 'var(--weight-ui)',
  },
  senseSelected: {
    color: 'var(--tint)',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: 'var(--weight-ui)',
  },
  senseKo: {
    fontSize: 'var(--text-small)',
    lineHeight: 'var(--lh-small)',
  },
  senseEn: {
    marginTop: '2px',
    color: 'var(--mute)',
    fontSize: '12px',
    lineHeight: '18px',
  },
  pos: {
    marginTop: '2px',
    color: 'var(--mute)',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    lineHeight: '16px',
  },
  targetWord: {
    fontFamily: 'var(--study-japanese)',
    fontWeight: 'var(--weight-ui)',
  },
  targetMeta: {
    display: 'block',
    marginTop: '2px',
    color: 'var(--mute)',
    fontSize: '12px',
    lineHeight: '18px',
  },
  example: {
    fontFamily: 'var(--study-japanese)',
    fontSize: 'var(--text-small)',
    lineHeight: '24px',
  },
  source: {
    display: 'block',
    marginTop: '2px',
    color: 'var(--mute)',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    lineHeight: '16px',
  },
} satisfies Record<string, CSSProperties>;

function uniqueText(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? '').filter(Boolean))];
}

function normalizeKana(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('ja')
    .replace(/[ァ-ヶ]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0x60),
    );
}

function sourceIds(card: LearningCard): string[] {
  return uniqueText([
    ...(card.sourceArticleIds ?? []),
    card.sourceArticleId,
  ]);
}

function sentenceFragments(bodyText: string): string[] {
  return bodyText
    .replace(/\r\n/g, '\n')
    .match(/[^。\n]+(?:。|\n|$)/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) ?? [];
}

function relatedExamples(
  card: LearningCard,
  articles: StudyArticle[],
  terms: string[],
  activeArticleId?: string | null,
): DictionaryExampleResult[] {
  const articleById = new Map(articles.map((article) => [article.id, article]));
  const relatedIds = uniqueText([
    activeArticleId,
    ...sourceIds(card),
  ]);
  const examples: DictionaryExampleResult[] = [];

  if (card.exampleJa.trim()) {
    examples.push({
      textJa: card.exampleJa.trim(),
      sourceLabel: card.sourceLabel || '학습 카드',
      articleId: card.sourceArticleId,
    });
  }

  relatedIds.forEach((articleId) => {
    const article = articleById.get(articleId);
    if (!article) return;
    sentenceFragments(article.bodyText)
      .filter((sentence) => terms.some((term) => term && sentence.includes(term)))
      .slice(0, 2)
      .forEach((sentence) => {
        examples.push({
          textJa: sentence,
          sourceLabel: `Day ${article.dayNo} · ${article.publisher}`,
          articleId: article.id,
        });
      });
  });

  return examples.filter(
    (example, index, all) =>
      all.findIndex((candidate) => candidate.textJa === example.textJa) === index,
  ).slice(0, 4);
}

function dictionaryLabel(reference?: DictionaryReference): string {
  if (!reference) return '학습 카드';
  const source = {
    jmdict: 'JMdict',
    kanjidic2: 'KANJIDIC2',
    jmnedict: 'JMnedict',
    custom: '직접 정리',
  }[reference.source];
  return reference.sourceVersion ? `${source} · ${reference.sourceVersion}` : source;
}

function wordResult(
  card: LearningCard,
  lexical: Extract<CardLexicalData, { kind: 'word' }> | null,
  articles: StudyArticle[],
  activeArticleId?: string | null,
): DictionaryWordResult {
  const headword = lexical?.dictionaryForm || card.front;
  const forms = uniqueText([headword, card.front, ...(lexical?.forms ?? [])]);
  const selectedReadings = uniqueText([
    lexical?.selectedReading,
    card.reading,
  ]);
  const dictionaryReadings = uniqueText(lexical?.readings ?? []);
  const hasOtherDictionaryReading = dictionaryReadings.some(
    (reading) => !selectedReadings.some(
      (selectedReading) => normalizeKana(selectedReading) === normalizeKana(reading),
    ),
  );
  const selectedSenseIds = new Set(lexical?.selectedSenseIds ?? []);
  const relevantSenses = hasOtherDictionaryReading && selectedSenseIds.size
    ? (lexical?.senses ?? []).filter((sense) => selectedSenseIds.has(sense.id))
    : lexical?.senses ?? [];
  const senses = relevantSenses.map((sense) => ({
    ...sense,
    selected: selectedSenseIds.has(sense.id),
  }));
  const meaningKo = [
    lexical?.meaningKoInContext,
    card.meaningKo,
    ...senses.map((sense) => sense.meaningKo),
  ].find((meaning) => meaning?.trim())?.trim() ?? '';

  return {
    id: card.id,
    kind: 'word',
    origin: 'workspace',
    headword,
    forms,
    readings: selectedReadings.length ? selectedReadings : dictionaryReadings,
    senses,
    meaningKo,
    examples: relatedExamples(card, articles, forms, activeArticleId),
    dictionaryLabel: dictionaryLabel(lexical?.dictionaryRef),
  };
}

function kanjiResult(
  card: LearningCard,
  lexical: Extract<CardLexicalData, { kind: 'kanji' }> | null,
  articles: StudyArticle[],
  activeArticleId?: string | null,
): DictionaryKanjiResult {
  const literal = lexical?.literal || card.front;
  const targets = lexical?.articleTargets ?? [];
  const terms = uniqueText([
    literal,
    ...targets.map((target) => target.word),
    ...(lexical?.exampleWords ?? []).map((example) => example.word),
  ]);

  return {
    id: card.id,
    kind: 'kanji',
    origin: 'workspace',
    literal,
    onReadings: uniqueText(lexical?.onReadings ?? []),
    kunReadings: uniqueText(lexical?.kunReadings ?? []),
    nanoriReadings: uniqueText(lexical?.nanoriReadings ?? []),
    koreanReadings: uniqueText(lexical?.koreanReadings ?? []),
    meaningsEn: uniqueText(lexical?.meaningsEn ?? []),
    meaningKo: uniqueText([
      ...(lexical?.meaningsKo ?? []),
      card.meaningKo,
    ]).join(' · '),
    grade: lexical?.grade,
    frequency: lexical?.frequency,
    strokeCount: lexical?.strokeCount,
    targets: targets.map((target) => ({ ...target })),
    examples: relatedExamples(card, articles, terms, activeArticleId),
    dictionaryLabel: dictionaryLabel(lexical?.dictionaryRef),
  };
}

function searchableValues(card: LearningCard): string[] {
  const lexical = card.lexicalData;
  if (lexical?.kind === 'word') {
    return uniqueText([
      card.front,
      card.reading,
      card.meaningKo,
      lexical.dictionaryForm,
      ...lexical.forms,
      ...lexical.readings,
      lexical.meaningKoInContext,
      ...lexical.senses.flatMap((sense) => [
        sense.meaningKo,
        ...sense.glossesEn,
      ]),
    ]);
  }
  if (lexical?.kind === 'kanji') {
    return uniqueText([
      card.front,
      card.reading,
      card.meaningKo,
      lexical.literal,
      ...lexical.onReadings,
      ...lexical.kunReadings,
      ...lexical.nanoriReadings,
      ...(lexical.koreanReadings ?? []),
      ...lexical.meaningsKo,
      ...lexical.meaningsEn,
      ...(lexical.exampleWords ?? []).flatMap((example) => [
        example.word,
        example.wordReading,
        example.characterReading,
      ]),
      ...lexical.articleTargets.flatMap((target) => [
        target.word,
        target.wordReading,
        target.characterReading,
        target.meaningKoInContext,
      ]),
    ]);
  }
  return uniqueText([card.front, card.reading, card.meaningKo]);
}

function matchScore(
  card: LearningCard,
  query: string,
  activeArticleId?: string | null,
): number {
  const normalizedQuery = normalizeKana(query);
  const values = searchableValues(card).map(normalizeKana);
  const front = normalizeKana(card.front);
  const reading = normalizeKana(card.reading);
  let score = 0;

  if (front === normalizedQuery) score = 120;
  else if (reading === normalizedQuery) score = 108;
  else if (values.some((value) => value === normalizedQuery)) score = 100;
  else if (front.startsWith(normalizedQuery)) score = 84;
  else if (front.includes(normalizedQuery)) score = 76;
  else if (values.some((value) => value.startsWith(normalizedQuery))) score = 64;
  else if (values.some((value) => value.includes(normalizedQuery))) score = 52;

  if (score && activeArticleId && sourceIds(card).includes(activeArticleId)) score += 6;
  if (score && card.lexicalData) score += 3;
  return score;
}

function resultIdentity(result: DictionaryResult): string {
  return result.kind === 'kanji'
    ? `kanji:${normalizeKana(result.literal)}`
    : `word:${normalizeKana(result.headword)}:${normalizeKana(result.readings[0] ?? '')}`;
}

function uniqueExamples(
  examples: DictionaryExampleResult[],
): DictionaryExampleResult[] {
  return examples.filter(
    (example, index, all) =>
      all.findIndex((candidate) => candidate.textJa === example.textJa) === index,
  ).slice(0, 4);
}

function senseIdentity(sense: DictionarySenseResult): string {
  const glosses = uniqueText(sense.glossesEn).map(normalizeKana).sort().join('|');
  const partsOfSpeech = uniqueText(sense.partsOfSpeech).map(normalizeKana).sort().join('|');
  if (glosses || partsOfSpeech) return `${glosses}:${partsOfSpeech}`;
  return `ko:${normalizeKana(sense.meaningKo)}:${sense.id}`;
}

function mergeSenses(senses: DictionarySenseResult[]): DictionarySenseResult[] {
  const merged = new Map<string, DictionarySenseResult>();
  senses.forEach((sense) => {
    const key = senseIdentity(sense);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, sense);
      return;
    }
    merged.set(key, {
      ...sense,
      ...current,
      partsOfSpeech: uniqueText([...current.partsOfSpeech, ...sense.partsOfSpeech]),
      glossesEn: uniqueText([...current.glossesEn, ...sense.glossesEn]),
      meaningKo: current.meaningKo || sense.meaningKo,
      selected: Boolean(current.selected || sense.selected),
    });
  });
  return [...merged.values()];
}

function mergeDictionaryLabels(current: string, incoming: string): string {
  if (!current) return incoming;
  if (!incoming || current === incoming) return current;
  return `${current} / ${incoming}`;
}

function mergeResults(results: DictionaryResult[]): DictionaryResult[] {
  const merged = new Map<string, DictionaryResult>();
  results.forEach((result) => {
    const key = resultIdentity(result);
    const current = merged.get(key);
    if (!current || current.kind !== result.kind) {
      merged.set(key, result);
      return;
    }

    if (current.kind === 'word' && result.kind === 'word') {
      merged.set(key, {
        ...result,
        ...current,
        meaningKo: current.meaningKo || result.meaningKo,
        forms: uniqueText([...current.forms, ...result.forms]),
        readings: uniqueText([...current.readings, ...result.readings]),
        senses: mergeSenses([...current.senses, ...result.senses]),
        examples: uniqueExamples([...current.examples, ...result.examples]),
        dictionaryLabel: mergeDictionaryLabels(
          current.dictionaryLabel,
          result.dictionaryLabel,
        ),
      });
      return;
    }

    if (current.kind === 'kanji' && result.kind === 'kanji') {
      merged.set(key, {
        ...result,
        ...current,
        meaningKo: current.meaningKo || result.meaningKo,
        onReadings: uniqueText([...current.onReadings, ...result.onReadings]),
        kunReadings: uniqueText([...current.kunReadings, ...result.kunReadings]),
        nanoriReadings: uniqueText([...current.nanoriReadings, ...result.nanoriReadings]),
        koreanReadings: uniqueText([...current.koreanReadings, ...result.koreanReadings]),
        meaningsEn: uniqueText([...current.meaningsEn, ...result.meaningsEn]),
        grade: current.grade ?? result.grade,
        frequency: current.frequency ?? result.frequency,
        strokeCount: current.strokeCount ?? result.strokeCount,
        targets: [...current.targets, ...result.targets].filter(
          (target, index, all) =>
            all.findIndex(
              (candidate) =>
                candidate.word === target.word
                && candidate.characterReading === target.characterReading,
            ) === index,
        ),
        examples: uniqueExamples([...current.examples, ...result.examples]),
        dictionaryLabel: mergeDictionaryLabels(
          current.dictionaryLabel,
          result.dictionaryLabel,
        ),
      });
    }
  });
  return [...merged.values()];
}

function resultMatchScore(result: DictionaryResult, query: string): number {
  const normalizedQuery = normalizeKana(query);
  const isSingleKanji = /^\p{Script=Han}$/u.test(query);
  if (result.kind === 'kanji') {
    const literal = normalizeKana(result.literal);
    if (literal === normalizedQuery) return isSingleKanji ? 1_400 : 1_300;
    const readings = [
      ...result.onReadings,
      ...result.kunReadings,
      ...result.nanoriReadings,
      ...result.koreanReadings,
    ].map(normalizeKana);
    if (readings.includes(normalizedQuery)) return 1_100;
    if (readings.some((reading) => reading.startsWith(normalizedQuery))) return 760;
    if (readings.some((reading) => reading.includes(normalizedQuery))) return 660;
    return 100;
  }

  const headword = normalizeKana(result.headword);
  const forms = result.forms.map(normalizeKana);
  const readings = result.readings.map(normalizeKana);
  if (headword === normalizedQuery) return 1_300;
  if (readings.includes(normalizedQuery)) return 1_250;
  if (forms.includes(normalizedQuery)) return 1_200;
  if (headword.startsWith(normalizedQuery)) return 850;
  if (forms.some((form) => form.startsWith(normalizedQuery))) return 820;
  if (headword.includes(normalizedQuery)) return 740;
  if (forms.some((form) => form.includes(normalizedQuery))) return 700;
  return 100;
}

function sortResults(results: DictionaryResult[], query: string): DictionaryResult[] {
  return results
    .map((result, index) => ({
      result,
      index,
      score: resultMatchScore(result, query),
    }))
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      if (left.result.origin !== right.result.origin) {
        return left.result.origin === 'workspace' ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map(({ result }) => result);
}

function searchWorkspace(
  workspace: Pick<StudyWorkspace, 'cards' | 'articles'>,
  query: string,
  activeArticleId?: string | null,
): DictionaryResult[] {
  return mergeResults(
    workspace.cards
      .map((card) => ({
        card,
        score: matchScore(card, query, activeArticleId),
      }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)
      .map(({ card }) => {
        const lexical = card.lexicalData;
        return card.kind === 'kanji'
          ? kanjiResult(
              card,
              lexical?.kind === 'kanji' ? lexical : null,
              workspace.articles,
              activeArticleId,
            )
          : wordResult(
              card,
              lexical?.kind === 'word' ? lexical : null,
              workspace.articles,
              activeArticleId,
            );
      }),
  );
}

function formatGrade(grade?: number): string {
  if (!grade) return '—';
  if (grade >= 1 && grade <= 6) return `일본 초등 ${grade}학년`;
  if (grade === 8) return '일본 중학교 이후';
  if (grade === 9 || grade === 10) return '인명용 한자';
  return `등급 ${grade}`;
}

function ResultExamples({ examples }: { examples: DictionaryExampleResult[] }): ReactElement | null {
  if (!examples.length) return null;
  return (
    <section style={styles.section} aria-label="관련 기사 예문">
      <h4 style={styles.sectionTitle}>관련 기사 예문</h4>
      <ul style={styles.list}>
        {examples.map((example, index) => (
          <li key={`${example.textJa}-${index}`} style={styles.listItem}>
            <p lang="ja" style={styles.example}>{example.textJa}</p>
            <small style={styles.source}>{example.sourceLabel}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WordResult({ result }: { result: DictionaryWordResult }): ReactElement {
  const alternateForms = result.forms.filter((form) => form !== result.headword);
  const hasEnglishSenses = result.senses.some((sense) => sense.glossesEn.length);
  return (
    <article style={styles.result} aria-labelledby={`dictionary-result-${result.id}`}>
      <header style={styles.resultHeader}>
        <div>
          <h3 id={`dictionary-result-${result.id}`} lang="ja" style={styles.headword}>
            {result.headword}
          </h3>
          <p lang="ja" style={styles.reading}>{result.readings.join(' · ') || '읽기 미등록'}</p>
        </div>
        <span style={styles.type}>단어</span>
      </header>
      {result.meaningKo ? (
        <>
          <span style={styles.meaningLabel}>기사·카드 뜻</span>
          <p style={styles.meaning}>{result.meaningKo}</p>
        </>
      ) : null}

      {alternateForms.length ? (
        <dl style={styles.facts}>
          <div style={styles.fact}>
            <dt style={styles.term}>다른 표기</dt>
            <dd lang="ja" style={styles.definition}>{alternateForms.join(' · ')}</dd>
          </div>
        </dl>
      ) : null}

      {result.senses.length ? (
        <section style={styles.section} aria-label="사전 뜻">
          <h4 style={styles.sectionTitle}>
            {hasEnglishSenses ? '사전 뜻 · 영어' : '사전 뜻'}
          </h4>
          <ol style={styles.list}>
            {result.senses.map((sense, index) => (
              <li key={sense.id || `${result.id}-sense-${index}`} style={styles.listItem}>
                <div style={styles.senseTopline}>
                  <span style={styles.senseNumber}>{index + 1}</span>
                  {sense.meaningKo ? <p style={styles.senseKo}>{sense.meaningKo}</p> : null}
                  {sense.selected ? <span style={styles.senseSelected}>이 기사 뜻</span> : null}
                </div>
                {sense.glossesEn.length ? (
                  <p lang="en" style={styles.senseEn}>{sense.glossesEn.join('; ')}</p>
                ) : null}
                {sense.partsOfSpeech.length ? (
                  <p style={styles.pos}>{sense.partsOfSpeech.join(' · ')}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <p style={styles.hint}>이 카드에는 아직 사전별 뜻 구분이 없습니다.</p>
      )}

      <ResultExamples examples={result.examples} />
      <small style={styles.source}>{result.dictionaryLabel}</small>
    </article>
  );
}

function KanjiResult({ result }: { result: DictionaryKanjiResult }): ReactElement {
  return (
    <article style={styles.result} aria-labelledby={`dictionary-result-${result.id}`}>
      <header style={styles.resultHeader}>
        <div>
          <h3 id={`dictionary-result-${result.id}`} lang="ja" style={styles.headword}>
            {result.literal}
          </h3>
          {result.meaningKo ? (
            <>
              <span style={styles.meaningLabel}>기사·카드 뜻</span>
              <p style={styles.meaning}>{result.meaningKo}</p>
            </>
          ) : null}
        </div>
        <span style={styles.type}>한자 1글자</span>
      </header>

      <dl style={styles.facts}>
        <div style={styles.fact}>
          <dt style={styles.term}>音読み</dt>
          <dd lang="ja" style={styles.definition}>{result.onReadings.join(' · ') || '—'}</dd>
        </div>
        <div style={styles.fact}>
          <dt style={styles.term}>訓読み</dt>
          <dd lang="ja" style={styles.definition}>{result.kunReadings.join(' · ') || '—'}</dd>
        </div>
        {result.nanoriReadings.length ? (
          <div style={styles.fact}>
            <dt style={styles.term}>名乗り</dt>
            <dd lang="ja" style={styles.definition}>{result.nanoriReadings.join(' · ')}</dd>
          </div>
        ) : null}
        {result.koreanReadings.length ? (
          <div style={styles.fact}>
            <dt style={styles.term}>한국 한자음</dt>
            <dd lang="ko" style={styles.definition}>{result.koreanReadings.join(' · ')}</dd>
          </div>
        ) : null}
        <div style={styles.fact}>
          <dt style={styles.term}>교육 단계</dt>
          <dd style={styles.definition}>{formatGrade(result.grade)}</dd>
        </div>
        <div style={styles.fact}>
          <dt style={styles.term}>획수</dt>
          <dd style={styles.definition}>{result.strokeCount ? `${result.strokeCount}획` : '—'}</dd>
        </div>
        {result.frequency ? (
          <div style={styles.fact}>
            <dt style={styles.term}>신문 빈도 순위</dt>
            <dd style={styles.definition}>{result.frequency.toLocaleString('ko-KR')}위</dd>
          </div>
        ) : null}
      </dl>

      {result.meaningsEn.length ? (
        <section style={styles.section} aria-label="영어 사전 뜻">
          <h4 style={styles.sectionTitle}>사전 뜻 · 영어</h4>
          <p lang="en" style={styles.senseEn}>{result.meaningsEn.join(' · ')}</p>
        </section>
      ) : null}

      {result.targets.length ? (
        <section style={styles.section} aria-label="기사에서의 읽기">
          <h4 style={styles.sectionTitle}>기사에서의 읽기</h4>
          <ul style={styles.list}>
            {result.targets.map((target, index) => (
              <li
                key={`${target.word}-${target.characterReading}-${index}`}
                style={styles.listItem}
              >
                <p lang="ja" style={styles.targetWord}>
                  {target.word}（{target.wordReading || '읽기 미등록'}）
                </p>
                <small style={styles.targetMeta}>
                  이 글자: {target.characterReading || '—'}
                  {target.meaningKoInContext ? ` · ${target.meaningKoInContext}` : ''}
                </small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ResultExamples examples={result.examples} />
      <small style={styles.source}>{result.dictionaryLabel}</small>
    </article>
  );
}

export function DictionaryPanel({
  workspace,
  activeArticleId,
  lookup,
  initialQuery = '',
  query: controlledQuery,
  onQueryChange,
  maxResults = 12,
  autoFocus = false,
  floating = false,
  className,
}: DictionaryPanelProps): ReactElement {
  const inputId = useId();
  const hintId = useId();
  const requestId = useRef(0);
  const [localQuery, setLocalQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [results, setResults] = useState<DictionaryResult[]>([]);
  const [status, setStatus] = useState<LookupStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [resultsExpanded, setResultsExpanded] = useState(true);

  const cardCountLabel = useMemo(
    () => `${workspace.cards.length.toLocaleString('ko-KR')}개 카드`,
    [workspace.cards.length],
  );

  useEffect(() => () => {
    requestId.current += 1;
  }, []);

  const query = controlledQuery ?? localQuery;

  const updateQuery = (nextQuery: string): void => {
    if (onQueryChange) onQueryChange(nextQuery);
    else setLocalQuery(nextQuery);
    const normalizedNextQuery = nextQuery.normalize('NFKC').trim();
    if (!submittedQuery || normalizedNextQuery === submittedQuery) return;
    requestId.current += 1;
    setSubmittedQuery('');
    setResults([]);
    setStatus('idle');
    setErrorMessage('');
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const normalizedQuery = query.normalize('NFKC').trim();
    if (!normalizedQuery) {
      setSubmittedQuery('');
      setResults([]);
      setStatus('idle');
      setErrorMessage('');
      return;
    }
    if (status === 'loading' && normalizedQuery === submittedQuery) return;

    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    const localResults = sortResults(
      searchWorkspace(workspace, normalizedQuery, activeArticleId),
      normalizedQuery,
    );
    setSubmittedQuery(normalizedQuery);
    setResults(localResults.slice(0, maxResults));
    setErrorMessage('');
    setResultsExpanded(true);

    if (!lookup) {
      setStatus(localResults.length ? 'success' : 'empty');
      return;
    }

    setStatus('loading');
    try {
      const lookedUpResults = await lookup(normalizedQuery);
      if (requestId.current !== currentRequest) return;
      const combined = sortResults(
        mergeResults([...localResults, ...lookedUpResults]),
        normalizedQuery,
      ).slice(0, maxResults);
      setResults(combined);
      setStatus(combined.length ? 'success' : 'empty');
    } catch (error) {
      if (requestId.current !== currentRequest) return;
      const message = error instanceof Error ? error.message : '사전 조회에 실패했습니다.';
      setErrorMessage(
        localResults.length
          ? `추가 사전 조회에 실패했습니다. 저장된 카드 결과만 표시합니다. ${message}`
          : message,
      );
      setStatus(localResults.length ? 'success' : 'error');
    }
  };

  const panelClassName = ['studyDictionaryPanel', className].filter(Boolean).join(' ');
  const resultsAreStale = Boolean(
    submittedQuery
    && query.normalize('NFKC').trim() !== submittedQuery,
  );
  const visibleStatus: LookupStatus = resultsAreStale ? 'idle' : status;
  const visibleResults = resultsAreStale ? [] : results;
  const isRepeatedLoadingQuery = status === 'loading'
    && query.normalize('NFKC').trim() === submittedQuery;
  const resultRegionId = `${inputId}-results`;
  const externalQuery = query.normalize('NFKC').trim();
  const naverDictionaryUrl = externalQuery
    ? `https://ja.dict.naver.com/#/search?query=${encodeURIComponent(externalQuery)}`
    : 'https://ja.dict.naver.com/';

  return (
    <section
      className={panelClassName}
      style={floating ? styles.floatingPanel : styles.panel}
      aria-labelledby={`${inputId}-heading`}
      aria-busy={visibleStatus === 'loading'}
    >
      <header style={styles.header}>
        <div>
          <p style={styles.kicker}>ARTICLE DICTIONARY</p>
          <h2 id={`${inputId}-heading`} style={styles.heading}>기사 안에서 바로 찾기</h2>
        </div>
        <span style={styles.inventory}>{cardCountLabel}</span>
      </header>

      <form role="search" onSubmit={submit} style={styles.form}>
        <label htmlFor={inputId} style={styles.label}>일본어 표기 또는 읽기</label>
        <div style={styles.searchRow}>
          <input
            id={inputId}
            type="search"
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            placeholder="예: 経緯、緯、けいい"
            lang="ja"
            autoComplete="off"
            enterKeyHint="search"
            spellCheck={false}
            aria-describedby={hintId}
            autoFocus={autoFocus}
            style={styles.input}
          />
          <button
            type="submit"
            disabled={!query.trim() || isRepeatedLoadingQuery}
            style={styles.button}
          >
            {visibleStatus === 'loading' ? '찾는 중' : '찾기'}
          </button>
        </div>
        <small id={hintId} style={styles.hint}>
          본문에서 최초 색을 남긴 표기가 자동으로 들어옵니다. 단어·한자·가나 읽기로 찾을 수 있습니다.
        </small>
      </form>

      <div aria-live="polite" aria-atomic="true">
        {visibleStatus === 'idle' ? (
          <p style={styles.state}>
            {resultsAreStale
              ? '새 표기가 입력되었습니다. 찾기를 누르면 이 표기로 다시 조회합니다.'
              : '기사에서 막힌 표기를 입력하세요. 먼저 내 카드의 사전 정보를 확인합니다.'}
          </p>
        ) : null}
        {visibleStatus === 'loading' ? (
          <p style={styles.state}>
            저장된 카드부터 확인했습니다. 추가 사전 정보를 불러오는 중입니다.
          </p>
        ) : null}
        {visibleStatus === 'empty' ? (
          <p style={styles.state}>
            “{submittedQuery}”에 맞는 항목을 찾지 못했습니다. 표기나 읽기를 다시 확인해 주세요.
          </p>
        ) : null}
        {visibleStatus === 'error' ? (
          <p role="alert" style={styles.error}>
            사전을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
            {errorMessage ? ` ${errorMessage}` : ''}
          </p>
        ) : null}
        {errorMessage && visibleStatus !== 'error' && !resultsAreStale ? (
          <p role="alert" style={styles.error}>{errorMessage}</p>
        ) : null}
      </div>

      {visibleResults.length ? (
        <div aria-label={`${submittedQuery} 검색 결과`}>
          <div style={styles.resultSummaryRow}>
            <p style={styles.resultSummary}>
              “{submittedQuery}” · {visibleResults.length}개 항목
            </p>
            <button
              type="button"
              aria-controls={resultRegionId}
              aria-expanded={resultsExpanded}
              onClick={() => setResultsExpanded((expanded) => !expanded)}
              style={floating
                ? { ...styles.collapseButton, minHeight: '44px' }
                : styles.collapseButton}
            >
              {resultsExpanded ? '결과 접기' : '결과 펼치기'}
            </button>
          </div>
          {resultsExpanded ? (
            <ol
              id={resultRegionId}
              style={floating
                ? { ...styles.resultViewport, maxHeight: 'none' }
                : styles.resultViewport}
            >
              {visibleResults.map((result) => (
                <li key={`${result.kind}-${result.id}`}>
                  {result.kind === 'word'
                    ? <WordResult result={result} />
                    : <KanjiResult result={result} />}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}

      <p className="studyDictionaryAttribution" style={styles.source}>
        한국어 뜻: <a href={naverDictionaryUrl} target="_blank" rel="noreferrer">네이버 일본어사전 ↗</a>
        {' · '}
        온라인 사전: <a href="https://jotoba.de/" target="_blank" rel="noreferrer">Jotoba</a>
        {' · '}원자료: <a href="https://www.edrdg.org/" target="_blank" rel="noreferrer">EDRDG · JMdict / KANJIDIC2</a>
      </p>
    </section>
  );
}

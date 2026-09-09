#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { lookupJotobaKanji, lookupJotobaWords } from '../src/study/dictionary.ts';
import {
  buildKanjiLexicalData,
  deriveKanjiArticleReading,
  dictionarySnapshotFromLexicalData,
  hasCompleteKanjiDictionaryData,
  hasDisplayableKanjiDictionaryData,
  selectKanjiExampleWords,
} from '../src/study/kanjiLexicon.ts';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETRY_DELAYS_MS = [0, 500, 1_500];

const HELP = `한자 카드 사전 파이프라인

사용법:
  npm run --silent study:kanji -- preview [--day N] [--user-id UUID]
  npm run --silent study:kanji -- apply   [--day N] [--user-id UUID]

KANJIDIC2 기반 음독·훈독·획수·학년·빈도와 실제 기사 단어를 같은 규칙으로
채웁니다. preview는 저장하지 않습니다. apply도 사전 정보가 비었거나 불완전한
한자 카드만 바꾸며 카드 ID, 복습 기록, 읽기, 뜻은 건드리지 않습니다.`;

export class KanjiPipelineError extends Error {}

function parseArguments(argv) {
  if (!argv.length || argv.includes('-h') || argv.includes('--help')) return { help: true };
  const [command, ...rest] = argv;
  if (!['preview', 'apply'].includes(command)) {
    throw new KanjiPipelineError(`알 수 없는 명령 '${command}'입니다.`);
  }
  const options = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index];
    if (!['--day', '--user-id'].includes(option)) {
      throw new KanjiPipelineError(`알 수 없는 옵션 '${option}'입니다.`);
    }
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) {
      throw new KanjiPipelineError(`${option} 뒤에 값이 필요합니다.`);
    }
    if (option === '--day') options.day = value;
    if (option === '--user-id') options.userId = value;
    index += 1;
  }
  if (options.day !== undefined) {
    if (!/^(0|[1-9]\d*)$/.test(options.day)) {
      throw new KanjiPipelineError('--day에는 0 이상의 정수를 입력해 주세요.');
    }
    options.day = Number(options.day);
  }
  if (options.userId && !UUID_PATTERN.test(options.userId)) {
    throw new KanjiPipelineError('--user-id에는 올바른 UUID를 입력해 주세요.');
  }
  return options;
}

export function createKanjiServiceClient() {
  const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').trim();
  const key = (process.env.SUPABASE_SECRET_KEY ?? '').trim();
  if (!url || !key) {
    throw new KanjiPipelineError('Supabase URL과 service-role secret이 필요합니다.');
  }
  return createClient(url.replace(/\/$/, ''), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function allUserIds(client) {
  const ids = [];
  for (let page = 1; page <= 10_000; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1_000 });
    if (error) throw new KanjiPipelineError('Auth 사용자를 읽지 못했습니다.');
    const users = data?.users ?? [];
    ids.push(...users.map((user) => user.id));
    if (users.length < 1_000) return ids;
  }
  throw new KanjiPipelineError('Auth 사용자가 너무 많습니다. --user-id를 지정해 주세요.');
}

export async function resolveKanjiPipelineUserId(client, requestedUserId) {
  if (requestedUserId) {
    const { data, error } = await client.auth.admin.getUserById(requestedUserId);
    if (error || !data?.user) throw new KanjiPipelineError('지정한 사용자를 찾지 못했습니다.');
    return data.user.id;
  }
  const ids = await allUserIds(client);
  if (ids.length !== 1) {
    throw new KanjiPipelineError(
      ids.length ? `Auth 사용자가 ${ids.length}명입니다. --user-id를 지정해 주세요.` : 'Auth 사용자가 없습니다.',
    );
  }
  return ids[0];
}

function splitReviewUnits(value) {
  return [...new Set(
    String(value ?? '')
      .normalize('NFKC')
      .split(/[・／/]/u)
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function targetSeedFromProposal(card, proposal, feedbackByAnnotation, allProposals) {
  const feedback = proposal.source_type === 'annotation'
    ? feedbackByAnnotation.get(proposal.source_id)
    : null;
  const siblingWords = allProposals.filter((candidate) =>
    candidate.kind === 'word'
    && candidate.session_id === proposal.session_id
    && candidate.source_type === proposal.source_type
    && candidate.source_id === proposal.source_id
    && candidate.front.includes(card.front)
    && candidate.reading?.trim()
    && candidate.decision !== 'rejected');
  if (siblingWords.length === 1) {
    const sibling = siblingWords[0];
    return {
      word: sibling.front,
      wordReading: sibling.reading,
      meaningKoInContext: feedback?.correct_meaning || sibling.meaning_ko || proposal.meaning_ko,
      articleId: proposal.source_article_id,
      ...(proposal.source_type === 'annotation' ? { annotationId: proposal.source_id } : {}),
    };
  }

  if (feedback) {
    const units = splitReviewUnits(feedback.review_unit).filter((unit) => unit.includes(card.front));
    if (units.length === 1 && feedback.correct_reading?.trim()) {
      return {
        word: units[0],
        wordReading: feedback.correct_reading,
        meaningKoInContext: feedback.correct_meaning || proposal.meaning_ko,
        articleId: proposal.source_article_id,
        annotationId: proposal.source_id,
      };
    }
  }

  throw new KanjiPipelineError(
    `${card.front} 카드의 기사 단어를 하나로 확정하지 못했습니다 (${siblingWords.length}개 후보).`,
  );
}

async function retryDictionaryLookup(literal) {
  let lastError;
  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      return await lookupJotobaKanji(literal);
    } catch (error) {
      lastError = error;
    }
  }
  const message = lastError instanceof Error ? lastError.message : '알 수 없는 사전 오류';
  throw new KanjiPipelineError(`${literal} KANJIDIC2 조회 실패: ${message}`);
}

async function retryExampleLookup(literal) {
  let lastError;
  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      return await lookupJotobaWords(`*${literal}*`);
    } catch (error) {
      lastError = error;
    }
  }
  const message = lastError instanceof Error ? lastError.message : '알 수 없는 사전 오류';
  throw new KanjiPipelineError(`${literal} 대표 단어 조회 실패: ${message}`);
}

async function retryArticleWordLookup(word) {
  let lastError;
  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      return await lookupJotobaWords(word);
    } catch (error) {
      lastError = error;
    }
  }
  const message = lastError instanceof Error ? lastError.message : '알 수 없는 사전 오류';
  throw new KanjiPipelineError(`${word} 기사 단어 조회 실패: ${message}`);
}

async function targetFromProposal(
  card,
  proposal,
  feedbackByAnnotation,
  allProposals,
  dictionary,
) {
  const seed = targetSeedFromProposal(card, proposal, feedbackByAnnotation, allProposals);
  const candidates = await retryArticleWordLookup(seed.word);
  const characterReading = deriveKanjiArticleReading(
    card.front,
    card.reading,
    seed.word,
    seed.wordReading,
    dictionary,
    candidates.map((candidate, sourceIndex) => ({
      word: candidate.headword,
      wordReading: candidate.readings[0] ?? '',
      furigana: candidate.furigana ?? '',
      common: candidate.common === true,
      sourceIndex,
    })),
  );
  if (!characterReading) {
    throw new KanjiPipelineError(
      `${seed.word}（${seed.wordReading}）에서 ${card.front}의 읽기 '${card.reading}'를 사전으로 확인하지 못했습니다.`,
    );
  }
  return { ...seed, characterReading };
}

function dictionarySnapshot(result) {
  return {
    literal: result.literal,
    onReadings: result.onReadings,
    kunReadings: result.kunReadings,
    nanoriReadings: result.nanoriReadings,
    koreanReadings: result.koreanReadings,
    meaningsEn: result.meaningsEn,
    grade: result.grade,
    frequency: result.frequency,
    strokeCount: result.strokeCount,
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function selectRequiredExampleWords(card, dictionary, targets, existing = null) {
  const exampleWords = existing?.exampleWords?.length
    ? existing.exampleWords
    : selectKanjiExampleWords(
        card.front,
        card.reading,
        dictionary,
        targets.map((target) => target.word),
        (await retryExampleLookup(card.front)).map((candidate, sourceIndex) => ({
          word: candidate.headword,
          wordReading: candidate.readings[0] ?? '',
          furigana: candidate.furigana ?? '',
          common: candidate.common === true,
          sourceIndex,
        })),
      );
  if (!exampleWords.length) {
    throw new KanjiPipelineError(
      `${card.front}의 읽기 '${card.reading}'와 맞는 대표 단어를 사전에서 찾지 못했습니다.`,
    );
  }
  return exampleWords;
}

function assertIncomingTargets(card, lexicalData, targets) {
  const incomingKeys = new Set(targets.map((target) =>
    [target.articleId ?? '', target.annotationId ?? '', target.word, target.wordReading].join('|')));
  const invalidTarget = lexicalData.articleTargets.find((target) => {
    const key = [target.articleId ?? '', target.annotationId ?? '', target.word, target.wordReading].join('|');
    return incomingKeys.has(key) && target.readingType === 'other';
  });
  if (invalidTarget) {
    throw new KanjiPipelineError(
      `${card.front}의 기사 읽기 '${invalidTarget.characterReading}'가 KANJIDIC2와 맞지 않습니다.`,
    );
  }
}

export async function preflightKanjiProposals(client, userId, { day }) {
  const { data: sessions, error: sessionError } = await client
    .from('study_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('day_no', day);
  if (sessionError) {
    throw new KanjiPipelineError(`Day ${day} 학습 정보를 읽지 못했습니다: ${sessionError.message}`);
  }
  const sessionIds = (sessions ?? []).map((session) => session.id);
  if (!sessionIds.length) throw new KanjiPipelineError(`Day ${day} 학습 정보를 찾지 못했습니다.`);
  const { data: proposals, error: proposalError } = await client
    .from('grading_card_proposals')
    .select('id,session_id,source_type,source_id,source_article_id,review_unit,kind,front,reading,meaning_ko,decision')
    .eq('user_id', userId)
    .in('session_id', sessionIds);
  if (proposalError) {
    throw new KanjiPipelineError(`Day ${day} 카드 후보를 읽지 못했습니다: ${proposalError.message}`);
  }
  const activeProposals = (proposals ?? []).filter((proposal) => proposal.decision !== 'rejected');
  const annotationIds = [...new Set(activeProposals
    .filter((proposal) => proposal.source_type === 'annotation' && proposal.source_id)
    .map((proposal) => proposal.source_id))];
  let feedbackRows = [];
  if (annotationIds.length) {
    const { data, error } = await client
      .from('annotation_grading_feedback')
      .select('annotation_id,review_unit,correct_reading,correct_meaning')
      .eq('user_id', userId)
      .in('annotation_id', annotationIds);
    if (error) {
      throw new KanjiPipelineError(`Day ${day} 표시 피드백을 읽지 못했습니다: ${error.message}`);
    }
    feedbackRows = data ?? [];
  }
  const feedbackByAnnotation = new Map(
    feedbackRows.map((feedback) => [feedback.annotation_id, feedback]),
  );
  const kanjiProposals = activeProposals.filter((proposal) => proposal.kind === 'kanji');
  await mapWithConcurrency(kanjiProposals, 4, async (proposal) => {
    const card = {
      front: proposal.front.normalize('NFKC').trim(),
      reading: proposal.reading.normalize('NFKC').trim(),
      meaning_ko: proposal.meaning_ko ?? '',
    };
    const dictionary = dictionarySnapshot(await retryDictionaryLookup(card.front));
    const target = await targetFromProposal(
      card,
      proposal,
      feedbackByAnnotation,
      activeProposals,
      dictionary,
    );
    const exampleWords = await selectRequiredExampleWords(card, dictionary, [target]);
    const lexicalData = buildKanjiLexicalData({
      literal: card.front,
      meaningKo: card.meaning_ko,
      targets: [target],
      exampleWords,
    }, dictionary);
    assertIncomingTargets(card, lexicalData, [target]);
  });
  return { cards: kanjiProposals.length };
}

async function loadRows(client, userId, { day, cardIds, missingOnly }) {
  let sessionQuery = client
    .from('study_sessions')
    .select('id,article_id,day_no')
    .eq('user_id', userId);
  if (day !== undefined) sessionQuery = sessionQuery.eq('day_no', day);
  const { data: sessions, error: sessionError } = await sessionQuery;
  if (sessionError) throw new KanjiPipelineError(`학습 Day를 읽지 못했습니다: ${sessionError.message}`);
  const sessionIds = new Set((sessions ?? []).map((session) => session.id));
  const articleIds = new Set((sessions ?? []).map((session) => session.article_id));

  let cardQuery = client
    .from('study_cards')
    .select('id,user_id,front,reading,meaning_ko,lexical_data')
    .eq('user_id', userId)
    .eq('kind', 'kanji')
    .order('front');
  if (cardIds?.length) cardQuery = cardQuery.in('id', [...new Set(cardIds)]);
  const { data: allCards, error: cardError } = await cardQuery;
  if (cardError) throw new KanjiPipelineError(`한자 카드를 읽지 못했습니다: ${cardError.message}`);

  const { data: proposals, error: proposalError } = await client
    .from('grading_card_proposals')
    .select('id,session_id,source_type,source_id,source_article_id,review_unit,kind,front,reading,meaning_ko,decision,created_card_id')
    .eq('user_id', userId);
  if (proposalError) {
    throw new KanjiPipelineError(`카드 생성 근거를 읽지 못했습니다: ${proposalError.message}`);
  }
  const scopedProposals = (proposals ?? []).filter((proposal) =>
    day === undefined || sessionIds.has(proposal.session_id));
  const acceptedByCard = new Map();
  scopedProposals
    .filter((proposal) => proposal.kind === 'kanji' && proposal.decision === 'accepted')
    .forEach((proposal) => {
      const items = acceptedByCard.get(proposal.created_card_id) ?? [];
      items.push(proposal);
      acceptedByCard.set(proposal.created_card_id, items);
    });

  const cards = (allCards ?? []).filter((card) => {
    if (
      missingOnly
      && (
        hasCompleteKanjiDictionaryData(card.lexical_data, card.front, card.reading)
        || (
          !card.lexical_data?.pipelineVersion
          && hasDisplayableKanjiDictionaryData(card.lexical_data, card.front)
        )
      )
    ) return false;
    if (cardIds?.length) return true;
    if (day === undefined) return true;
    return (acceptedByCard.get(card.id) ?? [])
      .some((proposal) => articleIds.has(proposal.source_article_id));
  });
  const annotationIds = [...new Set(scopedProposals
    .filter((proposal) => proposal.source_type === 'annotation' && proposal.source_id)
    .map((proposal) => proposal.source_id))];
  let feedbackRows = [];
  if (annotationIds.length) {
    const { data, error } = await client
      .from('annotation_grading_feedback')
      .select('annotation_id,review_unit,correct_reading,correct_meaning')
      .eq('user_id', userId)
      .in('annotation_id', annotationIds);
    if (error) throw new KanjiPipelineError(`기사 표기 피드백을 읽지 못했습니다: ${error.message}`);
    feedbackRows = data ?? [];
  }
  return {
    cards,
    proposals: scopedProposals,
    acceptedByCard,
    feedbackByAnnotation: new Map(feedbackRows.map((feedback) => [feedback.annotation_id, feedback])),
  };
}

export async function enrichKanjiCards(client, userId, options = {}) {
  const {
    day,
    cardIds,
    apply = false,
    missingOnly = true,
  } = options;
  const rows = await loadRows(client, userId, { day, cardIds, missingOnly });
  const updates = await mapWithConcurrency(rows.cards, 4, async (card) => {
    const cardProposals = rows.acceptedByCard.get(card.id) ?? [];
    if (!cardProposals.length) {
      throw new KanjiPipelineError(`${card.front} 카드의 수락된 생성 근거가 없습니다.`);
    }
    const existingLexicalData = hasDisplayableKanjiDictionaryData(
      card.lexical_data,
      card.front,
    ) ? card.lexical_data : null;
    const existing = hasCompleteKanjiDictionaryData(
      card.lexical_data,
      card.front,
      card.reading,
    )
      ? card.lexical_data
      : null;
    const dictionary = existing
      ? dictionarySnapshotFromLexicalData(existing)
      : dictionarySnapshot(await retryDictionaryLookup(card.front));
    const targets = await Promise.all(cardProposals.map((proposal) =>
      targetFromProposal(
        card,
        proposal,
        rows.feedbackByAnnotation,
        rows.proposals,
        dictionary,
      )));
    const exampleWords = await selectRequiredExampleWords(card, dictionary, targets, existing);
    const lexicalData = buildKanjiLexicalData({
      literal: card.front,
      meaningKo: card.meaning_ko ?? '',
      existingLexicalData,
      targets,
      exampleWords,
    }, dictionary);
    assertIncomingTargets(card, lexicalData, targets);
    return { card, lexicalData, targetCount: targets.length };
  });

  if (apply) {
    for (const update of updates) {
      const query = client
        .from('study_cards')
        .update({ lexical_data: update.lexicalData })
        .eq('id', update.card.id)
        .eq('user_id', userId)
        .select('id');
      const { data, error } = await query;
      if (error) throw new KanjiPipelineError(`${update.card.front} 저장 실패: ${error.message}`);
      if (data?.length !== 1) {
        throw new KanjiPipelineError(`${update.card.front} 저장 직전에 카드 상태가 바뀌었습니다.`);
      }
    }
  }

  return {
    mode: apply ? 'applied' : 'preview',
    day: day ?? null,
    cards: updates.length,
    targets: updates.reduce((sum, update) => sum + update.targetCount, 0),
    literals: updates.map((update) => update.card.front),
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const client = createKanjiServiceClient();
  const userId = await resolveKanjiPipelineUserId(client, options.userId);
  const result = await enrichKanjiCards(client, userId, {
    day: options.day,
    apply: options.command === 'apply',
    missingOnly: true,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    process.stderr.write(`오류: ${message}\n`);
    process.exitCode = 1;
  });
}

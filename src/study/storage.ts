import type { StudyWorkspace } from './model';

type LocalWorkspaceSlot = 'demo' | 'private';

const STORAGE_KEYS: Record<LocalWorkspaceSlot, string> = {
  demo: 'sewon-japanese-study-demo-v1',
  private: 'sewon-japanese-study-private-v2',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

const MAX_INT32 = 2_147_483_647;
const MAX_SMALLINT = 32_767;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function isIntegerBetween(value: unknown, minimum: number, maximum: number): value is number {
  return isInteger(value) && value >= minimum && value <= maximum;
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(2000, 0, 1));
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
  );
}

function isIsoDate(value: unknown): value is string {
  if (!isString(value)) return false;
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;
  return isCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function isIsoDateTime(value: unknown): value is string {
  if (!isString(value)) return false;
  const match = ISO_DATE_TIME_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second] = match;
  return (
    isCalendarDate(Number(year), Number(month), Number(day))
    && Number(hour) <= 23
    && Number(minute) <= 59
    && Number(second) <= 59
    && Number.isFinite(Date.parse(value))
  );
}

function validateFsrsState(value: unknown, path: string): string | null {
  if (!isRecord(value)) return `${path}의 복습 상태가 객체가 아닙니다.`;
  if (!isIsoDateTime(value.due)) return `${path}.due가 유효한 ISO 날짜·시간이 아닙니다.`;
  if (!isFiniteNumber(value.stability) || value.stability < 0) {
    return `${path}.stability는 0 이상의 유한한 숫자여야 합니다.`;
  }
  if (!isFiniteNumber(value.difficulty) || value.difficulty < 0 || value.difficulty > 10) {
    return `${path}.difficulty는 0부터 10 사이여야 합니다.`;
  }
  for (const field of [
    'elapsed_days',
    'scheduled_days',
    'learning_steps',
    'reps',
    'lapses',
  ] as const) {
    if (!isIntegerBetween(value[field], 0, MAX_INT32)) {
      return `${path}.${field}는 0 이상의 정수여야 합니다.`;
    }
  }
  if (!isIntegerBetween(value.state, 0, 3)) {
    return `${path}.state는 0부터 3 사이의 정수여야 합니다.`;
  }
  if (
    value.last_review !== undefined
    && !isIsoDateTime(value.last_review)
  ) {
    return `${path}.last_review가 유효한 ISO 날짜·시간이 아닙니다.`;
  }
  return null;
}

const annotationKinds = new Set([
  'reading_unknown',
  'context_guess',
  'unknown',
  'misread',
]);
const gradingStatuses = new Set([
  'draft',
  'submitted',
  'graded',
  'cards_confirmed',
  'failed',
]);
const gradingJudgements = new Set(['correct', 'partial', 'incorrect', 'ungraded']);
const gradingCardSourceTypes = new Set(['annotation', 'response', 'article']);
const gradingCardDecisions = new Set(['proposed', 'accepted', 'rejected']);

function isNullableString(value: unknown): boolean {
  return value === null || isString(value);
}

function validateAnnotationGrading(value: unknown, path: string): string | null {
  if (!isRecord(value)) return `${path}가 객체가 아닙니다.`;
  for (const field of [
    'userReading',
    'userMeaning',
    'correctReading',
    'correctMeaning',
  ] as const) {
    if (!isString(value[field])) return `${path}.${field}이 문자열이 아닙니다.`;
  }
  if (!gradingJudgements.has(String(value.judgement))) {
    return `${path}.judgement가 지원하는 판정이 아닙니다.`;
  }
  if (typeof value.simpleMistake !== 'boolean') {
    return `${path}.simpleMistake가 불리언이 아닙니다.`;
  }
  if (!isNonEmptyString(value.reviewUnit)) return `${path}.reviewUnit이 비어 있습니다.`;
  return null;
}

function validateResponseGrading(value: unknown, path: string): string | null {
  if (!isRecord(value)) return `${path}가 객체가 아닙니다.`;
  if (!gradingJudgements.has(String(value.judgement))) {
    return `${path}.judgement가 지원하는 판정이 아닙니다.`;
  }
  if (!Array.isArray(value.issues)) return `${path}.issues가 배열이 아닙니다.`;
  for (const [issueIndex, issue] of value.issues.entries()) {
    const issuePath = `${path}.issues[${issueIndex}]`;
    if (!isRecord(issue)) return `${issuePath}가 객체가 아닙니다.`;
    for (const field of ['quote', 'userInterpretation', 'correction', 'type'] as const) {
      if (!isString(issue[field])) return `${issuePath}.${field}이 문자열이 아닙니다.`;
    }
    if (typeof issue.simpleMistake !== 'boolean') {
      return `${issuePath}.simpleMistake가 불리언이 아닙니다.`;
    }
  }
  for (const field of [
    'correctPoints',
    'missingEvidence',
    'errorType',
    'correctedAnswer',
  ] as const) {
    if (!isString(value[field])) return `${path}.${field}이 문자열이 아닙니다.`;
  }
  return null;
}

function validateGradingPacket(value: unknown, path: string): string | null {
  if (!isRecord(value)) return `${path}이 객체가 아닙니다.`;
  if (!isIntegerBetween(value.packet_version, 1, MAX_INT32)) {
    return `${path}.packet_version은 1 이상의 정수여야 합니다.`;
  }
  if (!isNonEmptyString(value.submission_id)) return `${path}.submission_id가 비어 있습니다.`;
  if (!isNonEmptyString(value.session_id)) return `${path}.session_id가 비어 있습니다.`;
  if (!isRecord(value.article)) return `${path}.article이 객체가 아닙니다.`;
  if (!Array.isArray(value.responses)) return `${path}.responses가 배열이 아닙니다.`;
  if (!Array.isArray(value.annotations)) return `${path}.annotations가 배열이 아닙니다.`;
  return null;
}

function validateArticleGrading(value: unknown, path: string): string | null {
  if (!isRecord(value)) return `${path}이 객체가 아닙니다.`;
  if (!gradingStatuses.has(String(value.status))) {
    return `${path}.status가 지원하는 채점 상태가 아닙니다.`;
  }
  if (value.submissionId !== null && !isNonEmptyString(value.submissionId)) {
    return `${path}.submissionId가 비어 있습니다.`;
  }
  if (value.submissionSnapshot !== null) {
    const packetError = validateGradingPacket(value.submissionSnapshot, `${path}.submissionSnapshot`);
    if (packetError) return packetError;
  }
  for (const field of ['submittedAt', 'completedAt'] as const) {
    if (value[field] !== null && !isIsoDateTime(value[field])) {
      return `${path}.${field}이 유효한 ISO 날짜·시간이 아닙니다.`;
    }
  }
  if (value.diagnosis !== null) {
    if (!isRecord(value.diagnosis)) return `${path}.diagnosis가 객체가 아닙니다.`;
    if (
      !isFiniteNumber(value.diagnosis.comprehensionPct)
      || value.diagnosis.comprehensionPct < 0
      || value.diagnosis.comprehensionPct > 100
    ) {
      return `${path}.diagnosis.comprehensionPct는 0부터 100 사이여야 합니다.`;
    }
    for (const field of ['strengths', 'weaknesses', 'misreadPatterns', 'nextDirection'] as const) {
      if (!isString(value.diagnosis[field])) {
        return `${path}.diagnosis.${field}이 문자열이 아닙니다.`;
      }
    }
  }
  if (!Array.isArray(value.cardProposals)) return `${path}.cardProposals가 배열이 아닙니다.`;
  const proposalIds = new Set<string>();
  for (const [proposalIndex, proposal] of value.cardProposals.entries()) {
    const proposalPath = `${path}.cardProposals[${proposalIndex}]`;
    if (!isRecord(proposal)) return `${proposalPath}이 객체가 아닙니다.`;
    if (!isNonEmptyString(proposal.id)) return `${proposalPath}.id가 비어 있습니다.`;
    if (proposalIds.has(proposal.id)) return `${proposalPath}.id가 중복되었습니다.`;
    proposalIds.add(proposal.id);
    if (!gradingCardSourceTypes.has(String(proposal.sourceType))) {
      return `${proposalPath}.sourceType이 지원하는 출처가 아닙니다.`;
    }
    if (proposal.sourceId !== null && !isNonEmptyString(proposal.sourceId)) {
      return `${proposalPath}.sourceId가 비어 있습니다.`;
    }
    if (!isNonEmptyString(proposal.reviewUnit)) return `${proposalPath}.reviewUnit이 비어 있습니다.`;
    if (proposal.kind !== 'word' && proposal.kind !== 'kanji') {
      return `${proposalPath}.kind는 word 또는 kanji여야 합니다.`;
    }
    if (!isNonEmptyString(proposal.front)) return `${proposalPath}.front가 비어 있습니다.`;
    if (proposal.kind === 'kanji' && [...proposal.front].length !== 1) {
      return `${proposalPath}의 한자 카드는 한 글자여야 합니다.`;
    }
    for (const field of ['reading', 'meaningKo', 'exampleJa'] as const) {
      if (!isString(proposal[field])) return `${proposalPath}.${field}이 문자열이 아닙니다.`;
    }
    if (!gradingCardDecisions.has(String(proposal.decision))) {
      return `${proposalPath}.decision이 지원하는 결정이 아닙니다.`;
    }
    if (
      proposal.createdCardId !== undefined
      && proposal.createdCardId !== null
      && !isNonEmptyString(proposal.createdCardId)
    ) {
      return `${proposalPath}.createdCardId가 비어 있습니다.`;
    }
  }
  if (!isIntegerBetween(value.packetVersion, 1, MAX_INT32)) {
    return `${path}.packetVersion은 1 이상의 정수여야 합니다.`;
  }
  if (!isString(value.graderVersion)) return `${path}.graderVersion이 문자열이 아닙니다.`;
  if (!isNullableString(value.failureMessage)) {
    return `${path}.failureMessage가 문자열 또는 null이 아닙니다.`;
  }
  return null;
}

export function getWorkspaceValidationError(value: unknown): string | null {
  if (!isRecord(value)) return '최상위 데이터가 객체가 아닙니다.';
  if (value.version !== 1) return '지원하지 않는 학습 데이터 버전입니다.';
  if (!isIsoDateTime(value.updatedAt)) {
    return 'updatedAt이 유효한 ISO 날짜·시간이 아닙니다.';
  }
  if (!Array.isArray(value.articles)) return 'articles가 배열이 아닙니다.';
  if (!Array.isArray(value.responses)) return 'responses가 배열이 아닙니다.';
  if (!Array.isArray(value.cards)) return 'cards가 배열이 아닙니다.';
  if (!Array.isArray(value.reviewEvents)) return 'reviewEvents가 배열이 아닙니다.';

  const articleIds = new Set<string>();
  const articleDays = new Set<number>();
  const annotationIds = new Set<string>();

  for (const [articleIndex, article] of value.articles.entries()) {
    const path = `articles[${articleIndex}]`;
    if (!isRecord(article)) return `${path}가 객체가 아닙니다.`;
    if (!isNonEmptyString(article.id)) return `${path}.id가 비어 있습니다.`;
    if (article.sessionId !== undefined && !isNonEmptyString(article.sessionId)) {
      return `${path}.sessionId가 비어 있습니다.`;
    }
    if (articleIds.has(article.id)) return `기사 ID ${article.id}가 중복되었습니다.`;
    articleIds.add(article.id);

    if (!isIntegerBetween(article.dayNo, 0, MAX_INT32)) {
      return `${path}.dayNo는 0 이상의 정수여야 합니다.`;
    }
    if (articleDays.has(article.dayNo)) return `Day ${article.dayNo}이 중복되었습니다.`;
    articleDays.add(article.dayNo);

    if (!isNonEmptyString(article.title)) return `${path}.title이 비어 있습니다.`;
    if (!isString(article.publisher)) return `${path}.publisher가 문자열이 아닙니다.`;
    if (!isString(article.sourceUrl)) return `${path}.sourceUrl이 문자열이 아닙니다.`;
    if (
      !isString(article.publishedAt)
      || (article.publishedAt !== '' && !isIsoDate(article.publishedAt))
    ) {
      return `${path}.publishedAt은 YYYY-MM-DD 형식이어야 합니다.`;
    }
    if (!isString(article.bodyText)) return `${path}.bodyText가 문자열이 아닙니다.`;
    if (!isIntegerBetween(article.bodyRevision, 1, MAX_INT32)) {
      return `${path}.bodyRevision은 1 이상의 정수여야 합니다.`;
    }
    if (!Array.isArray(article.annotations)) return `${path}.annotations가 배열이 아닙니다.`;

    for (const [annotationIndex, annotation] of article.annotations.entries()) {
      const annotationPath = `${path}.annotations[${annotationIndex}]`;
      if (!isRecord(annotation)) return `${annotationPath}가 객체가 아닙니다.`;
      if (!isNonEmptyString(annotation.id)) return `${annotationPath}.id가 비어 있습니다.`;
      if (annotationIds.has(annotation.id)) {
        return `표시 ID ${annotation.id}가 중복되었습니다.`;
      }
      annotationIds.add(annotation.id);
      if (!annotationKinds.has(String(annotation.kind))) {
        return `${annotationPath}.kind가 지원하는 표시 유형이 아닙니다.`;
      }
      if (
        !isIntegerBetween(annotation.start, 0, article.bodyText.length)
        || !isIntegerBetween(annotation.end, 1, article.bodyText.length)
        || annotation.end <= annotation.start
      ) {
        return `${annotationPath}의 본문 위치가 범위를 벗어났습니다.`;
      }
      if (!isNonEmptyString(annotation.quote)) return `${annotationPath}.quote가 비어 있습니다.`;
      if (article.bodyText.slice(annotation.start, annotation.end) !== annotation.quote) {
        return `${annotationPath}.quote가 지정된 본문과 일치하지 않습니다.`;
      }
      if (!isString(annotation.note)) return `${annotationPath}.note가 문자열이 아닙니다.`;
      if (annotation.grading !== undefined) {
        const gradingError = validateAnnotationGrading(
          annotation.grading,
          `${annotationPath}.grading`,
        );
        if (gradingError) return gradingError;
      }
    }
    if (article.grading !== undefined) {
      const gradingError = validateArticleGrading(article.grading, `${path}.grading`);
      if (gradingError) return gradingError;
    }
  }

  const responseIds = new Set<string>();
  const responseOrdinals = new Set<string>();
  for (const [responseIndex, response] of value.responses.entries()) {
    const path = `responses[${responseIndex}]`;
    if (!isRecord(response)) return `${path}가 객체가 아닙니다.`;
    if (!isNonEmptyString(response.id)) return `${path}.id가 비어 있습니다.`;
    if (responseIds.has(response.id)) return `답안 ID ${response.id}가 중복되었습니다.`;
    responseIds.add(response.id);
    if (!isNonEmptyString(response.articleId) || !articleIds.has(response.articleId)) {
      return `${path}.articleId가 존재하는 기사를 가리키지 않습니다.`;
    }
    if (!isIntegerBetween(response.ordinal, 1, MAX_SMALLINT)) {
      return `${path}.ordinal은 1 이상의 정수여야 합니다.`;
    }
    const ordinalKey = `${response.articleId}|${response.ordinal}`;
    if (responseOrdinals.has(ordinalKey)) {
      return `${path}의 기사별 문항 번호가 중복되었습니다.`;
    }
    responseOrdinals.add(ordinalKey);
    if (!isString(response.perspective)) return `${path}.perspective가 문자열이 아닙니다.`;
    if (!isNonEmptyString(response.prompt)) return `${path}.prompt가 비어 있습니다.`;
    if (!isString(response.answer)) return `${path}.answer가 문자열이 아닙니다.`;
    if (!isString(response.referenceAnswer)) {
      return `${path}.referenceAnswer가 문자열이 아닙니다.`;
    }
    if (!isString(response.feedback)) return `${path}.feedback이 문자열이 아닙니다.`;
    if (response.grading !== undefined) {
      const gradingError = validateResponseGrading(response.grading, `${path}.grading`);
      if (gradingError) return gradingError;
    }
  }

  const cardIds = new Set<string>();
  const canonicalCards = new Set<string>();
  for (const [cardIndex, card] of value.cards.entries()) {
    const path = `cards[${cardIndex}]`;
    if (!isRecord(card)) return `${path}가 객체가 아닙니다.`;
    if (!isNonEmptyString(card.id)) return `${path}.id가 비어 있습니다.`;
    if (cardIds.has(card.id)) return `카드 ID ${card.id}가 중복되었습니다.`;
    cardIds.add(card.id);
    if (card.kind !== 'word' && card.kind !== 'kanji') {
      return `${path}.kind는 word 또는 kanji여야 합니다.`;
    }
    if (!isNonEmptyString(card.front)) return `${path}.front가 비어 있습니다.`;
    if (!isString(card.reading)) return `${path}.reading이 문자열이 아닙니다.`;
    if (!isString(card.meaningKo)) return `${path}.meaningKo가 문자열이 아닙니다.`;
    if (!isString(card.exampleJa)) return `${path}.exampleJa가 문자열이 아닙니다.`;
    if (!isNonEmptyString(card.canonicalKey)) return `${path}.canonicalKey가 비어 있습니다.`;
    if (card.kind === 'kanji' && [...card.front].length !== 1) {
      return `${path}의 한자 카드는 한 글자여야 합니다.`;
    }
    const expectedCanonicalKey =
      card.kind === 'kanji' ? card.front : `${card.front}|${card.reading}`;
    if (card.canonicalKey !== expectedCanonicalKey) {
      return `${path}.canonicalKey가 카드 표기와 읽기에 맞지 않습니다.`;
    }
    const canonicalIdentity = `${card.kind}|${card.canonicalKey}`;
    if (canonicalCards.has(canonicalIdentity)) {
      return `${path}와 같은 정규 카드가 중복되었습니다.`;
    }
    canonicalCards.add(canonicalIdentity);

    if (
      card.sourceArticleId !== null
      && (!isNonEmptyString(card.sourceArticleId) || !articleIds.has(card.sourceArticleId))
    ) {
      return `${path}.sourceArticleId가 존재하는 기사를 가리키지 않습니다.`;
    }
    if (card.sourceArticleIds !== undefined) {
      if (!Array.isArray(card.sourceArticleIds)) {
        return `${path}.sourceArticleIds가 배열이 아닙니다.`;
      }
      const uniqueSources = new Set<string>();
      for (const sourceId of card.sourceArticleIds) {
        if (!isNonEmptyString(sourceId) || !articleIds.has(sourceId)) {
          return `${path}.sourceArticleIds에 존재하지 않는 기사가 있습니다.`;
        }
        if (uniqueSources.has(sourceId)) {
          return `${path}.sourceArticleIds에 중복 기사가 있습니다.`;
        }
        uniqueSources.add(sourceId);
      }
      if (card.sourceArticleId !== null && !uniqueSources.has(card.sourceArticleId)) {
        return `${path}.sourceArticleIds에 대표 출처가 포함되어 있지 않습니다.`;
      }
    }
    if (!isString(card.sourceLabel)) return `${path}.sourceLabel이 문자열이 아닙니다.`;
    if (card.initialKind !== null && !annotationKinds.has(String(card.initialKind))) {
      return `${path}.initialKind가 지원하는 표시 유형이 아닙니다.`;
    }
    if (typeof card.suspended !== 'boolean') return `${path}.suspended가 불리언이 아닙니다.`;
    if (!isIntegerBetween(card.revision, 0, Number.MAX_SAFE_INTEGER)) {
      return `${path}.revision은 0 이상의 정수여야 합니다.`;
    }
    const fsrsError = validateFsrsState(card.fsrs, `${path}.fsrs`);
    if (fsrsError) return fsrsError;
  }

  const reviewIds = new Set<string>();
  const reviewRevisions = new Set<string>();
  for (const [reviewIndex, review] of value.reviewEvents.entries()) {
    const path = `reviewEvents[${reviewIndex}]`;
    if (!isRecord(review)) return `${path}가 객체가 아닙니다.`;
    if (!isNonEmptyString(review.id)) return `${path}.id가 비어 있습니다.`;
    if (reviewIds.has(review.id)) return `복습 이벤트 ID ${review.id}가 중복되었습니다.`;
    reviewIds.add(review.id);
    if (!isNonEmptyString(review.cardId) || !cardIds.has(review.cardId)) {
      return `${path}.cardId가 존재하는 카드를 가리키지 않습니다.`;
    }
    if (!isIntegerBetween(review.rating, 1, 4)) {
      return `${path}.rating은 1부터 4 사이의 정수여야 합니다.`;
    }
    if (!isIsoDateTime(review.reviewedAt)) {
      return `${path}.reviewedAt이 유효한 ISO 날짜·시간이 아닙니다.`;
    }
    if (!isIntegerBetween(review.durationMs, 0, MAX_INT32)) {
      return `${path}.durationMs는 0 이상의 정수여야 합니다.`;
    }
    if (!isIntegerBetween(review.baseRevision, 0, Number.MAX_SAFE_INTEGER)) {
      return `${path}.baseRevision은 0 이상의 정수여야 합니다.`;
    }
    if (
      !isIntegerBetween(review.resultingRevision, 1, Number.MAX_SAFE_INTEGER)
      || review.resultingRevision !== review.baseRevision + 1
    ) {
      return `${path}.resultingRevision은 baseRevision보다 정확히 1 커야 합니다.`;
    }
    const revisionKey = `${review.cardId}|${review.resultingRevision}`;
    if (reviewRevisions.has(revisionKey)) {
      return `${path}의 카드 복습 revision이 중복되었습니다.`;
    }
    reviewRevisions.add(revisionKey);
    const beforeError = validateFsrsState(review.beforeState, `${path}.beforeState`);
    if (beforeError) return beforeError;
    const afterError = validateFsrsState(review.afterState, `${path}.afterState`);
    if (afterError) return afterError;
    if (!isRecord(review.beforeState) || !isRecord(review.afterState)) {
      return `${path}의 복습 상태가 객체가 아닙니다.`;
    }
    const beforeReps = review.beforeState.reps;
    const afterReps = review.afterState.reps;
    const beforeLapses = review.beforeState.lapses;
    const afterLapses = review.afterState.lapses;
    if (
      !isInteger(beforeReps)
      || !isInteger(afterReps)
      || afterReps !== beforeReps + 1
    ) {
      return `${path}.afterState.reps가 1 증가하지 않았습니다.`;
    }
    if (
      !isInteger(beforeLapses)
      || !isInteger(afterLapses)
      || afterLapses < beforeLapses
      || afterLapses > beforeLapses + 1
    ) {
      return `${path}.afterState.lapses 증가 폭이 올바르지 않습니다.`;
    }
    if (
      review.afterState.last_review === undefined
      || Date.parse(String(review.afterState.last_review)) !== Date.parse(review.reviewedAt)
    ) {
      return `${path}.afterState.last_review가 reviewedAt과 일치하지 않습니다.`;
    }
    if (!isNonEmptyString(review.schedulerVersion)) {
      return `${path}.schedulerVersion이 비어 있습니다.`;
    }
  }

  return null;
}

function isWorkspace(value: unknown): value is StudyWorkspace {
  return getWorkspaceValidationError(value) === null;
}

export function loadLocalWorkspace(
  fallback: StudyWorkspace,
  slot: LocalWorkspaceSlot,
): StudyWorkspace {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS[slot]);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return isWorkspace(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function saveLocalWorkspace(
  workspace: StudyWorkspace,
  slot: LocalWorkspaceSlot,
): void {
  window.localStorage.setItem(STORAGE_KEYS[slot], JSON.stringify(workspace));
}

export async function readWorkspaceFile(file: File): Promise<StudyWorkspace> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('JSON 파일을 읽지 못했습니다. 파일이 손상되지 않았는지 확인해 주세요.');
  }
  const validationError = getWorkspaceValidationError(parsed);
  if (validationError) {
    throw new Error(`학습 데이터 오류: ${validationError}`);
  }
  return parsed as StudyWorkspace;
}

export function downloadWorkspace(workspace: StudyWorkspace): void {
  const payload = JSON.stringify(workspace, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `japanese-study-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

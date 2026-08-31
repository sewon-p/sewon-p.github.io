import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AnnotationKind,
  AnnotationGradingFeedback,
  CardLexicalData,
  ExclusionReason,
  GradingCardProposalDecision,
  LearningCard,
  LearningState,
  NewLearningCard,
  ReviewEvent,
  SerializableFsrsCard,
  StudyArticle,
  StudyResponse,
  StudyGradingResult,
  StudyGradingPacket,
  StudyWorkspace,
} from './model';
import { createSerializableFsrsCard, SCHEDULER_VERSION } from './scheduler';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const hasSupabaseConfig = Boolean(supabaseUrl && supabasePublishableKey);

export const supabase: SupabaseClient | null = hasSupabaseConfig
  ? createClient(supabaseUrl!, supabasePublishableKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

interface ArticleRow {
  id: string;
  title: string;
  publisher: string | null;
  source_url: string | null;
  published_at: string | null;
  body_text: string;
  body_revision: number;
  updated_at: string;
}

interface SessionRow {
  id: string;
  article_id: string;
  day_no: number;
  grading_status: 'draft' | 'submitted' | 'graded' | 'cards_confirmed' | 'failed';
  grading_packet_version: number;
  grading_grader_version: string;
  grading_failure_message: string | null;
  grading_submission_id: string | null;
  grading_snapshot: StudyGradingPacket | null;
  grading_submitted_at: string | null;
  grading_completed_at: string | null;
}

interface ResponseRow {
  id: string;
  session_id: string;
  ordinal: number;
  perspective: string;
  prompt: string;
  answer: string;
  reference_answer: string | null;
  feedback: string | null;
}

interface AnnotationRow {
  id: string;
  article_id: string;
  kind: AnnotationKind;
  start_offset: number;
  end_offset: number;
  quote: string;
  note: string | null;
}

interface CardRow {
  id: string;
  kind: 'word' | 'kanji';
  canonical_key: string;
  front: string;
  reading: string | null;
  meaning_ko: string | null;
  example_ja: string | null;
  initial_kind: AnnotationKind | null;
  suspended: boolean;
  learning_state?: LearningState;
  excluded_reason?: ExclusionReason | null;
  excluded_at?: string | null;
  lexical_data?: CardLexicalData | null;
  due_at: string;
  fsrs_state: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  last_review_at: string | null;
  revision: number;
}

interface CardSourceRow {
  card_id: string;
  article_id: string;
  context_text: string | null;
}

interface StoredFsrsState {
  due_at: string;
  fsrs_state: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  last_review_at: string | null;
}

interface ReviewEventRow {
  event_id: string;
  card_id: string;
  base_revision: number;
  resulting_revision: number;
  rating: 1 | 2 | 3 | 4;
  reviewed_at: string;
  duration_ms: number | null;
  before_state: StoredFsrsState;
  after_state: StoredFsrsState;
  scheduler_version: string;
}

interface GradingReportRow {
  session_id: string;
  comprehension_pct: number;
  strengths: string;
  weaknesses: string;
  misread_patterns: string;
  next_direction: string;
}

interface ResponseGradingRow {
  response_id: string;
  judgement: AnnotationGradingFeedback['judgement'];
  issues: Array<{ quote: string; userInterpretation: string; correction: string; type: string; simpleMistake: boolean }>;
  correct_points: string;
  missing_evidence: string;
  error_type: string;
  corrected_answer: string;
}

interface AnnotationGradingRow {
  annotation_id: string;
  user_reading: string;
  user_meaning: string;
  correct_reading: string;
  correct_meaning: string;
  judgement: AnnotationGradingFeedback['judgement'];
  simple_mistake: boolean;
  review_unit: string;
}

interface GradingCardProposalRow {
  id: string;
  session_id: string;
  source_type: 'annotation' | 'response' | 'article';
  source_id: string | null;
  review_unit: string;
  kind: 'word' | 'kanji';
  front: string;
  reading: string;
  meaning_ko: string;
  example_ja: string;
  decision: GradingCardProposalDecision;
  created_card_id: string | null;
}

export interface RemoteCardLearningStateResult {
  cardId: string;
  learningState: LearningState;
  suspended: boolean;
  excludedReason: ExclusionReason | null;
  excludedAt: string | null;
  revision: number;
}

export interface RemoteReviewBatchResult {
  eventId: string;
  ok: boolean;
  error?: string;
  code?: string;
}

function requireClient(): SupabaseClient {
  if (!supabase) throw new Error('Supabase 연결값이 설정되지 않았습니다.');
  return supabase;
}

function throwIfError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

function fsrsFromRow(row: CardRow): SerializableFsrsCard {
  return {
    due: row.due_at,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.fsrs_state,
    last_review: row.last_review_at ?? undefined,
  };
}

function fsrsFromStoredState(state: StoredFsrsState): SerializableFsrsCard {
  return {
    due: state.due_at,
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: state.elapsed_days,
    scheduled_days: state.scheduled_days,
    learning_steps: state.learning_steps,
    reps: state.reps,
    lapses: state.lapses,
    state: state.fsrs_state,
    last_review: state.last_review_at ?? undefined,
  };
}

function storedFsrsPayload(state: SerializableFsrsCard, revision: number) {
  return {
    due_at: state.due,
    fsrs_state: state.state,
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: state.elapsed_days,
    scheduled_days: state.scheduled_days,
    learning_steps: state.learning_steps,
    reps: state.reps,
    lapses: state.lapses,
    last_review_at: state.last_review ?? null,
    revision,
  };
}

function reviewEventRpcPayload(event: ReviewEvent) {
  const after = event.afterState;
  return {
    event_id: event.id,
    card_id: event.cardId,
    expected_revision: event.baseRevision,
    rating: event.rating,
    reviewed_at: event.reviewedAt,
    duration_ms: event.durationMs,
    after_state: {
      due_at: after.due,
      fsrs_state: after.state,
      stability: after.stability,
      difficulty: after.difficulty,
      elapsed_days: after.elapsed_days,
      scheduled_days: after.scheduled_days,
      learning_steps: after.learning_steps,
      reps: after.reps,
      lapses: after.lapses,
    },
    scheduler_version: event.schedulerVersion,
  };
}

function cardInsertPayload(userId: string, card: LearningCard | NewLearningCard) {
  const id = 'id' in card ? card.id : crypto.randomUUID();
  const fsrsState = 'fsrs' in card ? card.fsrs : createSerializableFsrsCard();
  const revision = 'revision' in card ? card.revision : 0;
  const legacySuspended = 'suspended' in card ? card.suspended : false;
  const learningState = 'learningState' in card
    ? card.learningState ?? (legacySuspended ? 'suspended' : 'active')
    : 'active';
  const excludedReason = 'excludedReason' in card ? card.excludedReason ?? null : null;
  const excludedAt = 'excludedAt' in card ? card.excludedAt ?? null : null;
  return {
    id,
    user_id: userId,
    kind: card.kind,
    canonical_key:
      'canonicalKey' in card
        ? card.canonicalKey
        : `${card.front}|${card.reading}`,
    front: card.front,
    reading: card.reading || null,
    meaning_ko: card.meaningKo || null,
    example_ja: card.exampleJa || null,
    initial_kind: card.initialKind,
    suspended: learningState !== 'active',
    learning_state: learningState,
    excluded_reason: learningState === 'excluded' ? excludedReason : null,
    excluded_at:
      learningState === 'excluded' ? excludedAt ?? new Date().toISOString() : null,
    lexical_data: card.lexicalData ?? null,
    due_at: fsrsState.due,
    fsrs_state: fsrsState.state,
    stability: fsrsState.stability,
    difficulty: fsrsState.difficulty,
    elapsed_days: fsrsState.elapsed_days,
    scheduled_days: fsrsState.scheduled_days,
    learning_steps: fsrsState.learning_steps,
    reps: fsrsState.reps,
    lapses: fsrsState.lapses,
    last_review_at: fsrsState.last_review ?? null,
    revision,
  };
}

export async function getCurrentSession(): Promise<Session | null> {
  const client = requireClient();
  const { data, error } = await client.auth.getSession();
  throwIfError(error);
  return data.session;
}

const STUDY_ACCOUNT_DOMAIN = 'auth.sewon-p.github.io';

export async function signInWithStudyId(studyId: string): Promise<void> {
  const client = requireClient();
  const normalizedId = studyId.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(normalizedId)) {
    throw new Error('아이디는 영문 소문자와 숫자로 입력해 주세요.');
  }
  const { error } = await client.auth.signInWithPassword({
    email: `${normalizedId}@${STUDY_ACCOUNT_DOMAIN}`,
    password: normalizedId,
  });
  if (error) throw new Error('등록된 아이디를 확인해 주세요.');
}

export async function signOut(): Promise<void> {
  const { error } = await requireClient().auth.signOut();
  throwIfError(error);
}

export async function loadRemoteWorkspace(): Promise<StudyWorkspace> {
  const client = requireClient();
  const [
    articlesResult,
    sessionsResult,
    responsesResult,
    annotationsResult,
    cardsResult,
    sourcesResult,
    reviewsResult,
    gradingReportsResult,
    responseGradingResult,
    annotationGradingResult,
    gradingCardProposalsResult,
  ] =
    await Promise.all([
      client.from('articles').select('*').order('created_at', { ascending: true }),
      client.from('study_sessions').select(
        'id, article_id, day_no, grading_status, grading_packet_version, grading_grader_version, grading_failure_message, grading_submission_id, grading_snapshot, grading_submitted_at, grading_completed_at',
      ).order('day_no'),
      client.from('responses').select('*').order('ordinal'),
      client.from('annotations').select('*').order('start_offset'),
      client.from('study_cards').select('*').order('created_at'),
      client.from('study_card_sources').select('card_id, article_id, context_text'),
      client.from('study_review_events').select('*').order('reviewed_at'),
      client.from('study_grading_reports').select('*'),
      client.from('response_grading_feedback').select('*'),
      client.from('annotation_grading_feedback').select('*'),
      client.from('grading_card_proposals').select('*').order('created_at'),
    ]);

  [
    articlesResult,
    sessionsResult,
    responsesResult,
    annotationsResult,
    cardsResult,
    sourcesResult,
    reviewsResult,
    gradingReportsResult,
    responseGradingResult,
    annotationGradingResult,
    gradingCardProposalsResult,
  ]
    .forEach((result) => throwIfError(result.error));

  const articleRows = (articlesResult.data ?? []) as ArticleRow[];
  const sessionRows = (sessionsResult.data ?? []) as SessionRow[];
  const responseRows = (responsesResult.data ?? []) as ResponseRow[];
  const annotationRows = (annotationsResult.data ?? []) as AnnotationRow[];
  const cardRows = (cardsResult.data ?? []) as CardRow[];
  const sourceRows = (sourcesResult.data ?? []) as CardSourceRow[];
  const reviewRows = (reviewsResult.data ?? []) as ReviewEventRow[];
  const gradingReportRows = (gradingReportsResult.data ?? []) as GradingReportRow[];
  const responseGradingRows = (responseGradingResult.data ?? []) as ResponseGradingRow[];
  const annotationGradingRows = (annotationGradingResult.data ?? []) as AnnotationGradingRow[];
  const gradingCardProposalRows = (gradingCardProposalsResult.data ?? []) as GradingCardProposalRow[];
  const sessionById = new Map(sessionRows.map((row) => [row.id, row]));
  const sessionByArticle = new Map(sessionRows.map((row) => [row.article_id, row]));
  const gradingReportBySession = new Map(
    gradingReportRows.map((row) => [row.session_id, row]),
  );
  const responseGradingById = new Map(
    responseGradingRows.map((row) => [row.response_id, row]),
  );
  const annotationGradingById = new Map(
    annotationGradingRows.map((row) => [row.annotation_id, row]),
  );
  const sourcesByCard = new Map<string, CardSourceRow[]>();
  sourceRows.forEach((row) => {
    const rows = sourcesByCard.get(row.card_id) ?? [];
    rows.push(row);
    sourcesByCard.set(row.card_id, rows);
  });

  const articles: StudyArticle[] = articleRows.map((row) => ({
    id: row.id,
    sessionId: sessionByArticle.get(row.id)?.id,
    dayNo: sessionByArticle.get(row.id)?.day_no ?? 0,
    title: row.title,
    publisher: row.publisher ?? '',
    sourceUrl: row.source_url ?? '',
    publishedAt: row.published_at ?? '',
    bodyText: row.body_text,
    annotations: annotationRows
      .filter((annotation) => annotation.article_id === row.id)
      .map((annotation) => ({
        id: annotation.id,
        start: annotation.start_offset,
        end: annotation.end_offset,
        quote: annotation.quote,
        kind: annotation.kind,
        note: annotation.note ?? '',
        grading: (() => {
          const grading = annotationGradingById.get(annotation.id);
          if (!grading) return undefined;
          return {
            userReading: grading.user_reading,
            userMeaning: grading.user_meaning,
            correctReading: grading.correct_reading,
            correctMeaning: grading.correct_meaning,
            judgement: grading.judgement,
            simpleMistake: grading.simple_mistake,
            reviewUnit: grading.review_unit,
          };
        })(),
      })),
    bodyRevision: row.body_revision,
    grading: (() => {
      const session = sessionByArticle.get(row.id);
      if (!session) return undefined;
      const report = gradingReportBySession.get(session.id);
      return {
        status: session.grading_status,
        submissionId: session.grading_submission_id,
        submissionSnapshot: session.grading_snapshot,
        submittedAt: session.grading_submitted_at,
        completedAt: session.grading_completed_at,
        diagnosis: report
          ? {
              comprehensionPct: report.comprehension_pct,
              strengths: report.strengths,
              weaknesses: report.weaknesses,
              misreadPatterns: report.misread_patterns,
              nextDirection: report.next_direction,
            }
          : null,
        cardProposals: gradingCardProposalRows
          .filter((proposal) => proposal.session_id === session.id)
          .map((proposal) => ({
            id: proposal.id,
            sourceType: proposal.source_type,
            sourceId: proposal.source_id,
            reviewUnit: proposal.review_unit,
            kind: proposal.kind,
            front: proposal.front,
            reading: proposal.reading,
            meaningKo: proposal.meaning_ko,
            exampleJa: proposal.example_ja,
            decision: proposal.decision,
            createdCardId: proposal.created_card_id,
          })),
        packetVersion: session.grading_packet_version,
        graderVersion: session.grading_grader_version,
        failureMessage: session.grading_failure_message,
      };
    })(),
  }));

  const responses: StudyResponse[] = responseRows.flatMap((row) => {
    const session = sessionById.get(row.session_id);
    if (!session) return [];
    return [{
      id: row.id,
      articleId: session.article_id,
      ordinal: row.ordinal,
      perspective: row.perspective,
      prompt: row.prompt,
      answer: row.answer,
      referenceAnswer: row.reference_answer ?? '',
      feedback: row.feedback ?? '',
      grading: (() => {
        const grading = responseGradingById.get(row.id);
        if (!grading) return undefined;
        return {
          judgement: grading.judgement,
          issues: grading.issues,
          correctPoints: grading.correct_points,
          missingEvidence: grading.missing_evidence,
          errorType: grading.error_type,
          correctedAnswer: grading.corrected_answer,
        };
      })(),
    }];
  });

  const cards: LearningCard[] = cardRows.map((row) => {
    const sources = sourcesByCard.get(row.id) ?? [];
    const source = sources[0];
    const sourceSession = source ? sessionByArticle.get(source.article_id) : undefined;
    const learningState = row.learning_state
      ?? (row.suspended ? 'suspended' : 'active');
    return {
      id: row.id,
      kind: row.kind,
      canonicalKey: row.canonical_key,
      front: row.front,
      reading: row.reading ?? '',
      meaningKo: row.meaning_ko ?? '',
      exampleJa: row.example_ja ?? source?.context_text ?? '',
      sourceArticleId: source?.article_id ?? null,
      sourceArticleIds: sources.map((item) => item.article_id),
      sourceLabel: sourceSession ? `Day ${sourceSession.day_no}` : '직접 등록',
      initialKind: row.initial_kind,
      suspended: learningState !== 'active',
      learningState,
      excludedReason: row.excluded_reason ?? null,
      excludedAt: row.excluded_at ?? null,
      lexicalData: row.lexical_data ?? null,
      revision: row.revision,
      fsrs: fsrsFromRow(row),
    };
  });

  const reviewEvents: ReviewEvent[] = reviewRows.map((row) => ({
    id: row.event_id,
    cardId: row.card_id,
    rating: row.rating,
    reviewedAt: row.reviewed_at,
    durationMs: row.duration_ms ?? 0,
    baseRevision: row.base_revision,
    resultingRevision: row.resulting_revision,
    beforeState: fsrsFromStoredState(row.before_state),
    afterState: fsrsFromStoredState(row.after_state),
    schedulerVersion: row.scheduler_version,
  }));

  return {
    version: 1,
    articles,
    responses,
    cards,
    reviewEvents,
    updatedAt: articleRows.at(-1)?.updated_at ?? new Date().toISOString(),
  };
}

export async function saveRemoteArticle(article: StudyArticle, userId: string): Promise<void> {
  const { error } = await requireClient().rpc('save_study_article', {
    p_user_id: userId,
    p_article_id: article.id,
    p_body_text: article.bodyText,
    p_body_revision: article.bodyRevision,
    p_annotations: article.annotations.map((annotation) => ({
      id: annotation.id,
      kind: annotation.kind,
      start_offset: annotation.start,
      end_offset: annotation.end,
      quote: annotation.quote,
      note: annotation.note || null,
    })),
  });
  throwIfError(error);
}

export async function saveRemoteResponse(response: StudyResponse): Promise<void> {
  const { error } = await requireClient().rpc('save_study_response', {
    p_response_id: response.id,
    p_answer: response.answer,
  });
  throwIfError(error);
}

export async function createRemoteCard(
  card: LearningCard,
  userId: string,
): Promise<void> {
  const client = requireClient();
  const { error } = await client.from('study_cards').insert(cardInsertPayload(userId, card));
  throwIfError(error);
  if (!card.sourceArticleId) return;
  await linkRemoteCardSource(
    card.id,
    card.sourceArticleId,
    card.exampleJa,
    userId,
  );
}

export async function linkRemoteCardSource(
  cardId: string,
  articleId: string,
  contextText: string,
  userId: string,
): Promise<void> {
  const { error } = await requireClient().rpc('link_study_card_source', {
    p_user_id: userId,
    p_card_id: cardId,
    p_article_id: articleId,
    p_context_text: contextText || null,
  });
  throwIfError(error);
}

export async function setRemoteCardSuspended(
  cardId: string,
  suspended: boolean,
  expectedRevision?: number,
): Promise<RemoteCardLearningStateResult> {
  return setRemoteCardLearningState(
    cardId,
    suspended ? 'suspended' : 'active',
    null,
    expectedRevision,
  );
}

export async function setRemoteCardLearningState(
  cardId: string,
  learningState: LearningState,
  reason: ExclusionReason | null = null,
  expectedRevision?: number,
): Promise<RemoteCardLearningStateResult> {
  const { data, error } = await requireClient().rpc('set_study_card_learning_state', {
    p_card_id: cardId,
    p_learning_state: learningState,
    p_reason: learningState === 'excluded' ? reason : null,
    p_expected_revision: expectedRevision ?? null,
  });
  throwIfError(error);
  const row = (Array.isArray(data) ? data[0] : data) as CardRow | null;
  if (!row) throw new Error('카드 학습 상태 저장 결과가 없습니다.');
  const savedState = row.learning_state ?? (row.suspended ? 'suspended' : 'active');
  return {
    cardId: row.id,
    learningState: savedState,
    suspended: savedState !== 'active',
    excludedReason: row.excluded_reason ?? null,
    excludedAt: row.excluded_at ?? null,
    revision: row.revision,
  };
}

export async function recordRemoteReview(event: ReviewEvent): Promise<void> {
  const payload = reviewEventRpcPayload(event);
  const { error } = await requireClient().rpc('record_review', {
    p_event_id: payload.event_id,
    p_card_id: payload.card_id,
    p_expected_revision: payload.expected_revision,
    p_rating: payload.rating,
    p_reviewed_at: payload.reviewed_at,
    p_duration_ms: payload.duration_ms,
    p_after_state: payload.after_state,
    p_scheduler_version: payload.scheduler_version,
  });
  throwIfError(error);
}

export async function recordRemoteReviewBatch(
  events: ReviewEvent[],
): Promise<RemoteReviewBatchResult[]> {
  if (!events.length) return [];
  const { data, error } = await requireClient().rpc('record_reviews_batch', {
    p_events: events.map(reviewEventRpcPayload),
  });
  throwIfError(error);
  if (!Array.isArray(data)) {
    throw new Error('복습 배치 저장 결과 형식이 올바르지 않습니다.');
  }
  return data.map((item, index) => {
    const result = item as {
      event_id?: unknown;
      ok?: unknown;
      error?: unknown;
      code?: unknown;
    };
    return {
      eventId:
        typeof result.event_id === 'string' ? result.event_id : events[index]?.id ?? `index:${index + 1}`,
      ok: result.ok === true,
      ...(typeof result.error === 'string' ? { error: result.error } : {}),
      ...(typeof result.code === 'string' ? { code: result.code } : {}),
    };
  });
}

export async function saveRemoteAnnotationInput(
  annotationId: string,
  userReading: string,
  userMeaning: string,
  userId: string,
): Promise<void> {
  const { error } = await requireClient().rpc('save_annotation_study_input', {
    p_user_id: userId,
    p_annotation_id: annotationId,
    p_user_reading: userReading,
    p_user_meaning: userMeaning,
  });
  throwIfError(error);
}

export async function requestRemoteGrading(
  sessionId: string,
  userId: string,
): Promise<StudyGradingPacket> {
  const { data, error } = await requireClient().rpc('request_study_grading', {
    p_user_id: userId,
    p_session_id: sessionId,
  });
  throwIfError(error);
  return data as StudyGradingPacket;
}

export async function getRemoteGradingPacket(
  sessionId: string,
  userId: string,
): Promise<StudyGradingPacket> {
  const { data, error } = await requireClient().rpc('get_study_grading_packet', {
    p_user_id: userId,
    p_session_id: sessionId,
  });
  throwIfError(error);
  return data as StudyGradingPacket;
}

export async function applyRemoteGradingResult(
  sessionId: string,
  submissionId: string,
  result: StudyGradingResult,
  userId: string,
): Promise<void> {
  const { error } = await requireClient().rpc('apply_study_grading_result', {
    p_user_id: userId,
    p_session_id: sessionId,
    p_submission_id: submissionId,
    p_result: {
      grader_version: result.graderVersion,
      diagnosis: {
        comprehension_pct: result.diagnosis.comprehensionPct,
        strengths: result.diagnosis.strengths,
        weaknesses: result.diagnosis.weaknesses,
        misread_patterns: result.diagnosis.misreadPatterns,
        next_direction: result.diagnosis.nextDirection,
      },
      responses: result.responses.map((feedback) => ({
        response_id: feedback.responseId,
        judgement: feedback.judgement,
        issues: feedback.issues,
        correct_points: feedback.correctPoints,
        missing_evidence: feedback.missingEvidence,
        error_type: feedback.errorType,
        corrected_answer: feedback.correctedAnswer,
      })),
      annotations: result.annotations.map((feedback) => ({
        annotation_id: feedback.annotationId,
        correct_reading: feedback.correctReading,
        correct_meaning: feedback.correctMeaning,
        judgement: feedback.judgement,
        simple_mistake: feedback.simpleMistake,
        review_unit: feedback.reviewUnit,
      })),
      card_proposals: result.cardProposals.map((proposal) => ({
        proposal_id: proposal.id,
        source_type: proposal.sourceType,
        source_id: proposal.sourceId,
        review_unit: proposal.reviewUnit,
        kind: proposal.kind,
        front: proposal.front,
        reading: proposal.reading,
        meaning_ko: proposal.meaningKo,
        example_ja: proposal.exampleJa,
      })),
    },
  });
  throwIfError(error);
}

export async function markRemoteGradingFailed(
  sessionId: string,
  submissionId: string,
  message: string,
  graderVersion: string,
  userId: string,
): Promise<void> {
  const { error } = await requireClient().rpc('mark_study_grading_failed', {
    p_user_id: userId,
    p_session_id: sessionId,
    p_submission_id: submissionId,
    p_message: message,
    p_grader_version: graderVersion,
  });
  throwIfError(error);
}

export async function decideRemoteGradingCardProposal(
  proposalId: string,
  decision: Exclude<GradingCardProposalDecision, 'proposed'>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await requireClient().rpc('decide_grading_card_proposal', {
    p_user_id: userId,
    p_proposal_id: proposalId,
    p_decision: decision,
  });
  throwIfError(error);
  return data as string | null;
}

export async function confirmRemoteGradingCards(
  sessionId: string,
  userId: string,
): Promise<void> {
  const { error } = await requireClient().rpc('confirm_study_grading_cards', {
    p_user_id: userId,
    p_session_id: sessionId,
  });
  throwIfError(error);
}

export async function importRemoteWorkspace(
  workspace: StudyWorkspace,
  userId: string,
): Promise<void> {
  const { error } = await requireClient().rpc('import_study_workspace', {
    p_user_id: userId,
    p_workspace: {
      version: workspace.version,
      scheduler_version: SCHEDULER_VERSION,
      articles: workspace.articles.map((article) => ({
        import_key: article.id,
        day_no: article.dayNo,
        title: article.title,
        publisher: article.publisher || null,
        source_url: article.sourceUrl || null,
        published_at: article.publishedAt || null,
        body_text: article.bodyText,
        body_revision: article.bodyRevision,
        annotations: article.annotations.map((annotation) => ({
          import_key: annotation.id,
          kind: annotation.kind,
          start_offset: annotation.start,
          end_offset: annotation.end,
          quote: annotation.quote,
          note: annotation.note || null,
        })),
      })),
      responses: workspace.responses.map((response) => ({
        import_key: response.id,
        article_import_key: response.articleId,
        ordinal: response.ordinal,
        perspective: response.perspective,
        prompt: response.prompt,
        answer: response.answer,
        reference_answer: response.referenceAnswer || null,
        feedback: response.feedback || null,
      })),
      cards: workspace.cards.map((card) => ({
        import_key: card.id,
        kind: card.kind,
        canonical_key: card.canonicalKey,
        front: card.front,
        reading: card.reading || null,
        meaning_ko: card.meaningKo || null,
        example_ja: card.exampleJa || null,
        source_article_keys: [
          ...(card.sourceArticleIds ?? []),
          ...(card.sourceArticleId ? [card.sourceArticleId] : []),
        ].filter((articleId, index, all) => all.indexOf(articleId) === index),
        initial_kind: card.initialKind,
        suspended: (card.learningState ?? (card.suspended ? 'suspended' : 'active')) !== 'active',
        learning_state: card.learningState ?? (card.suspended ? 'suspended' : 'active'),
        excluded_reason: card.excludedReason ?? null,
        excluded_at: card.excludedAt ?? null,
        lexical_data: card.lexicalData ?? null,
        current_state: storedFsrsPayload(card.fsrs, card.revision),
      })),
      review_events: workspace.reviewEvents.map((event) => ({
        event_id: event.id,
        card_import_key: event.cardId,
        rating: event.rating,
        reviewed_at: event.reviewedAt,
        duration_ms: event.durationMs,
        base_revision: event.baseRevision,
        resulting_revision: event.resultingRevision,
        before_state: storedFsrsPayload(event.beforeState, event.baseRevision),
        after_state: storedFsrsPayload(event.afterState, event.resultingRevision),
        scheduler_version: event.schedulerVersion,
      })),
      grading_sessions: workspace.articles.flatMap((article) =>
        article.grading
          ? [{ article_import_key: article.id, ...article.grading }]
          : []),
      response_grading_feedback: workspace.responses.flatMap((response) =>
        response.grading
          ? [{
              article_import_key: response.articleId,
              response_import_key: response.id,
              ...response.grading,
            }]
          : []),
      annotation_grading_feedback: workspace.articles.flatMap((article) =>
        article.annotations.flatMap((annotation) =>
          annotation.grading
            ? [{
                article_import_key: article.id,
                annotation_import_key: annotation.id,
                ...annotation.grading,
              }]
            : [])),
    },
  });
  throwIfError(error);
}

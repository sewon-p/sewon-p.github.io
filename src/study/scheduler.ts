import {
  GenSeedStrategyWithCardId,
  Rating,
  StrategyMode,
  createEmptyCard,
  fsrs,
  type Card,
  type Grade,
} from 'ts-fsrs';
import type {
  LearningCard,
  ReviewEvent,
  SerializableFsrsCard,
} from './model';

export const SCHEDULER_VERSION = 'fsrs-6/ts-fsrs-5.4.1-seeded-kst4-v3';

export const STUDY_DAY_ROLLOVER_HOUR = 4;

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const STUDY_DAY_ROLLOVER_MS = STUDY_DAY_ROLLOVER_HOUR * 60 * 60 * 1000;

const scheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ['1m', '10m'],
  relearning_steps: ['10m'],
}).useStrategy(StrategyMode.SEED, GenSeedStrategyWithCardId('card_id'));

type SeededFsrsCard = Card & { card_id: string };

export const ratingOrder = [
  Rating.Again,
  Rating.Hard,
  Rating.Good,
  Rating.Easy,
] as const;

export const ratingCopy: Record<Grade, { label: string; hint: string }> = {
  [Rating.Again]: { label: '모름', hint: '회상 실패' },
  [Rating.Hard]: { label: '겨우 맞음', hint: '정답이지만 힘들었음' },
  [Rating.Good]: { label: '맞음', hint: '정상적으로 회상' },
  [Rating.Easy]: { label: '바로 앎', hint: '고민 없이 회상' },
};

export function serializeFsrsCard(card: Card): SerializableFsrsCard {
  return {
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    due: card.due.toISOString(),
    last_review: card.last_review?.toISOString(),
  };
}

export function hydrateFsrsCard(card: SerializableFsrsCard): Card {
  return {
    ...card,
    due: new Date(card.due),
    last_review: card.last_review ? new Date(card.last_review) : undefined,
  };
}

export function createSerializableFsrsCard(now = new Date()): SerializableFsrsCard {
  return serializeFsrsCard(createEmptyCard(now));
}

function hydrateLearningCard(card: LearningCard): SeededFsrsCard {
  return {
    ...hydrateFsrsCard(card.fsrs),
    card_id: card.id,
  };
}

function hasDailyInterval(scheduledDays: number): boolean {
  return Number.isFinite(scheduledDays) && scheduledDays >= 1;
}

/**
 * Returns 04:00 KST on the study day `scheduledDays` after `reviewedAt`.
 * A review before 04:00 belongs to the preceding study day.
 */
export function getStudyDayDue(reviewedAt: Date, scheduledDays: number): Date {
  const studyDay = Math.floor(
    (reviewedAt.getTime() + KST_OFFSET_MS - STUDY_DAY_ROLLOVER_MS) / DAY_MS,
  );
  return new Date(
    (studyDay + scheduledDays) * DAY_MS - KST_OFFSET_MS + STUDY_DAY_ROLLOVER_MS,
  );
}

function alignDailyDue(card: Card, reviewedAt: Date): Card {
  if (!hasDailyInterval(card.scheduled_days)) return card;
  return {
    ...card,
    due: getStudyDayDue(reviewedAt, card.scheduled_days),
  };
}

/**
 * Interprets legacy cards with the same 04:00 KST day boundary without a data migration.
 * Short learning and relearning steps keep their exact stored timestamps.
 */
export function getEffectiveDueDate(card: LearningCard): Date {
  if (hasDailyInterval(card.fsrs.scheduled_days) && card.fsrs.last_review) {
    const lastReview = new Date(card.fsrs.last_review);
    if (!Number.isNaN(lastReview.getTime())) {
      return getStudyDayDue(lastReview, card.fsrs.scheduled_days);
    }
  }
  return new Date(card.fsrs.due);
}

export function getRatingPreview(card: LearningCard, now = new Date()) {
  const result = scheduler.repeat(hydrateLearningCard(card), now);
  return ratingOrder.map((rating) => {
    const previewCard = alignDailyDue(result[rating].card, now);
    return {
      rating,
      due: previewCard.due,
      scheduledDays: previewCard.scheduled_days,
    };
  });
}

export function reviewCard(
  learningCard: LearningCard,
  rating: Grade,
  startedAt: number,
  now = new Date(),
): { card: LearningCard; event: ReviewEvent } {
  const beforeState = learningCard.fsrs;
  const result = scheduler.next(hydrateLearningCard(learningCard), now, rating);
  const afterState = serializeFsrsCard(alignDailyDue(result.card, now));
  const nextRevision = learningCard.revision + 1;

  return {
    card: {
      ...learningCard,
      revision: nextRevision,
      fsrs: afterState,
    },
    event: {
      id: crypto.randomUUID(),
      cardId: learningCard.id,
      rating,
      reviewedAt: now.toISOString(),
      durationMs: Math.max(0, Date.now() - startedAt),
      baseRevision: learningCard.revision,
      resultingRevision: nextRevision,
      beforeState,
      afterState,
      schedulerVersion: SCHEDULER_VERSION,
    },
  };
}

function formatDayInterval(days: number): string {
  if (days < 30) return `${days}일`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}개월`;
  return `${Math.round(months / 12)}년`;
}

export function formatDueInterval(
  due: Date,
  now = new Date(),
  scheduledDays?: number,
): string {
  if (scheduledDays !== undefined && hasDailyInterval(scheduledDays)) {
    return formatDayInterval(scheduledDays);
  }
  const minutes = Math.max(1, Math.round((due.getTime() - now.getTime()) / 60000));
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간`;
  const days = Math.round(hours / 24);
  return formatDayInterval(days);
}

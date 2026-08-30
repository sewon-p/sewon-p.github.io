import {
  Rating,
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

export const SCHEDULER_VERSION = 'fsrs-6/ts-fsrs-5.4.1';

const scheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ['10m'],
  relearning_steps: ['10m'],
});

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
    ...card,
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

export function getRatingPreview(card: LearningCard, now = new Date()) {
  const result = scheduler.repeat(hydrateFsrsCard(card.fsrs), now);
  return ratingOrder.map((rating) => ({
    rating,
    due: result[rating].card.due,
  }));
}

export function reviewCard(
  learningCard: LearningCard,
  rating: Grade,
  startedAt: number,
  now = new Date(),
): { card: LearningCard; event: ReviewEvent } {
  const beforeState = learningCard.fsrs;
  const result = scheduler.next(hydrateFsrsCard(beforeState), now, rating);
  const afterState = serializeFsrsCard(result.card);
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

export function formatDueInterval(due: Date, now = new Date()): string {
  const minutes = Math.max(1, Math.round((due.getTime() - now.getTime()) / 60000));
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}일`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}개월`;
  return `${Math.round(months / 12)}년`;
}

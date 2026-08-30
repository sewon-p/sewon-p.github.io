import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Rating, type Grade } from 'ts-fsrs';
import type { LearningCard } from './model';
import {
  formatDueInterval,
  getRatingPreview,
  ratingCopy,
  ratingOrder,
} from './scheduler';

interface ReviewSessionProps {
  cards: LearningCard[];
  onRate: (cardId: string, rating: Grade, startedAt: number) => void;
  onOpenLibrary: () => void;
}

interface ActiveReviewProps {
  card: LearningCard;
  position: number;
  total: number;
  progress: number;
  onRate: (rating: Grade, startedAt: number) => void;
}

function isDue(card: LearningCard, now: number): boolean {
  return !card.suspended && new Date(card.fsrs.due).getTime() <= now;
}

function ActiveReview({
  card,
  position,
  total,
  progress,
  onRate,
}: ActiveReviewProps): ReactElement {
  const [answerShown, setAnswerShown] = useState(false);
  const [ratingPending, setRatingPending] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const previews = useMemo(() => getRatingPreview(card), [card]);

  const rate = (rating: Grade): void => {
    if (!answerShown || ratingPending) return;
    setRatingPending(true);
    onRate(rating, startedAt);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!answerShown && (event.code === 'Space' || event.code === 'Enter')) {
        event.preventDefault();
        setAnswerShown(true);
        return;
      }
      if (!answerShown) return;
      const keyMap: Record<string, Grade> = {
        Digit1: Rating.Again,
        Digit2: Rating.Hard,
        Digit3: Rating.Good,
        Digit4: Rating.Easy,
      };
      const rating = keyMap[event.code];
      if (rating) rate(rating);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <div className="studyPage studyReviewPage">
      <header className="studyReviewHeader">
        <div>
          <p className="studyKicker">TODAY · REVIEW</p>
          <span>{card.kind === 'kanji' ? '한자 1글자' : '단어'}</span>
        </div>
        <p>
          {String(position).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </p>
      </header>

      <div className="studyReviewProgress" aria-hidden="true">
        <span style={{ transform: `scaleX(${progress / 100})` }} />
      </div>

      <main className="studyReviewStage">
        <section className="studyFlashcard" aria-live="polite">
          <div className="studyCardTopline">
            <span>{card.sourceLabel}</span>
            <span>복습 {card.fsrs.reps}회</span>
          </div>
          <p
            className={card.kind === 'kanji' ? 'studyCardKanji' : 'studyCardWord'}
            lang="ja"
          >
            {card.front}
          </p>

          <div
            className={`studyAnswerReveal ${answerShown ? 'studyAnswerRevealOpen' : ''}`}
            aria-hidden={!answerShown}
          >
            {answerShown ? (
              <div>
                <p className="studyCardReading" lang="ja">{card.reading}</p>
                <p className="studyCardMeaning">{card.meaningKo}</p>
                {card.exampleJa ? (
                  <p className="studyCardExample" lang="ja">{card.exampleJa}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      </main>

      <footer className="studyReviewActions">
        {!answerShown ? (
          <button
            type="button"
            className="studyRevealButton"
            onClick={() => setAnswerShown(true)}
          >
            정답 보기
            <span>Space</span>
          </button>
        ) : (
          <div className="studyRatingGrid">
            {ratingOrder.map((rating, index) => {
              const preview = previews.find((item) => item.rating === rating);
              return (
                <button
                  type="button"
                  key={rating}
                  className={`studyRatingButton studyRating${rating}`}
                  onClick={() => rate(rating)}
                  disabled={ratingPending}
                  aria-label={`${ratingCopy[rating].label}, ${ratingCopy[rating].hint}`}
                >
                  <span>{ratingCopy[rating].label}</span>
                  <small>
                    {preview ? formatDueInterval(preview.due) : '계산 중'} · {index + 1}
                  </small>
                </button>
              );
            })}
          </div>
        )}
        {answerShown ? (
          <p className="studyHardRule">틀렸다면 ‘겨우 맞음’이 아니라 반드시 ‘모름’을 누릅니다.</p>
        ) : null}
      </footer>
    </div>
  );
}

export function ReviewSession({
  cards,
  onRate,
  onOpenLibrary,
}: ReviewSessionProps): ReactElement {
  const [sessionReviewed, setSessionReviewed] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const dueCards = useMemo(
    () =>
      cards
        .filter((card) => isDue(card, clock))
        .sort(
          (a, b) =>
            new Date(a.fsrs.due).getTime() - new Date(b.fsrs.due).getTime() ||
            a.front.localeCompare(b.front, 'ja'),
        ),
    [cards, clock],
  );
  const activeCard = dueCards[0] ?? null;

  if (!activeCard) {
    return (
      <div className="studyPage studyReviewPage">
        <header className="studyReviewHeader">
          <p className="studyKicker">TODAY · REVIEW</p>
          <span>{sessionReviewed}개 복습</span>
        </header>
        <section className="studyReviewComplete" aria-live="polite">
          <span className="studyCompletionGlyph" aria-hidden="true">済</span>
          <h1>오늘 카드는 끝났습니다.</h1>
          <p>다음 카드는 기억 상태에 맞춰 자동으로 다시 나옵니다.</p>
          <button type="button" onClick={onOpenLibrary}>전체 카드 보기</button>
        </section>
      </div>
    );
  }

  const total = dueCards.length + sessionReviewed;
  const progress = total === 0 ? 100 : (sessionReviewed / total) * 100;

  return (
    <ActiveReview
      key={activeCard.id}
      card={activeCard}
      position={sessionReviewed + 1}
      total={total}
      progress={progress}
      onRate={(rating, startedAt) => {
        onRate(activeCard.id, rating, startedAt);
        setSessionReviewed((value) => value + 1);
      }}
    />
  );
}

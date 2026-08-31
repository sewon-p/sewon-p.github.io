import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Rating, State, type Grade } from 'ts-fsrs';
import type { LearningCard } from './model';
import {
  formatDueInterval,
  getRatingPreview,
  ratingCopy,
  ratingOrder,
} from './scheduler';

const LEARN_AHEAD_MS = 20 * 60 * 1000;

interface ReviewSessionProps {
  cards: LearningCard[];
  onRate: (
    cardId: string,
    rating: Grade,
    startedAt: number,
    reviewedAt: Date,
  ) => LearningCard | null;
  onExclude: (cardId: string) => void;
  onOpenLibrary: () => void;
}

interface QueueEntry {
  id: string;
  cardId: string;
  availableAt: number;
}

interface ActiveReviewProps {
  card: LearningCard;
  remaining: number;
  attempts: number;
  progress: number;
  onRate: (rating: Grade, startedAt: number, reviewedAt: Date) => void;
  onExclude: () => void;
}

function isStudyable(card: LearningCard): boolean {
  return !card.suspended && card.learningState !== 'excluded';
}

function isDue(card: LearningCard, now: number): boolean {
  return isStudyable(card) && new Date(card.fsrs.due).getTime() <= now;
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function dueDateThenRandom(cards: LearningCard[], random: () => number): LearningCard[] {
  const buckets = new Map<number, LearningCard[]>();
  cards.forEach((card) => {
    const dueDay = Math.floor(new Date(card.fsrs.due).getTime() / 86_400_000);
    buckets.set(dueDay, [...(buckets.get(dueDay) ?? []), card]);
  });
  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, bucket]) => shuffled(bucket, random));
}

function articleWords(card: LearningCard): string[] {
  if (card.lexicalData?.kind === 'kanji') {
    return card.lexicalData.articleTargets.map((target) => target.word);
  }
  return card.kind === 'word' ? [card.front] : [];
}

function areSiblings(left: LearningCard, right: LearningCard): boolean {
  if (left.id === right.id) return true;
  if (left.kind === 'kanji' && right.kind === 'word') {
    return right.front.includes(left.front);
  }
  if (left.kind === 'word' && right.kind === 'kanji') {
    return left.front.includes(right.front);
  }
  const leftWords = articleWords(left);
  const rightWords = articleWords(right);
  return leftWords.some((word) => rightWords.includes(word));
}

function separateSiblings(cards: LearningCard[]): LearningCard[] {
  const pending = [...cards];
  const result: LearningCard[] = [];
  while (pending.length) {
    const previous = result.at(-1);
    const nextIndex = previous
      ? pending.findIndex((candidate) => !areSiblings(previous, candidate))
      : 0;
    const [next] = pending.splice(nextIndex < 0 ? 0 : nextIndex, 1);
    result.push(next);
  }
  return result;
}

function createSessionQueue(
  cards: LearningCard[],
  now: number,
  sessionSeed: string,
): QueueEntry[] {
  const studyableCards = cards.filter(isStudyable);
  const dueCards = studyableCards.filter((card) => isDue(card, now));
  const learning = studyableCards
    .filter(
      (card) =>
        (card.fsrs.state === State.Learning || card.fsrs.state === State.Relearning)
        && new Date(card.fsrs.due).getTime() <= now + LEARN_AHEAD_MS,
    )
    .sort((a, b) => new Date(a.fsrs.due).getTime() - new Date(b.fsrs.due).getTime());
  const learningIds = new Set(learning.map((card) => card.id));
  const review = dueCards.filter(
    (card) => card.fsrs.state === State.Review && !learningIds.has(card.id),
  );
  const fresh = dueCards.filter(
    (card) => card.fsrs.state === State.New && !learningIds.has(card.id),
  );
  const queuedCards = [...learning, ...review, ...fresh];
  const random = createRandom(`${sessionSeed}:${queuedCards.map((card) => card.id).join(':')}`);
  const ordered = [
    ...learning,
    ...separateSiblings(dueDateThenRandom(review, random)),
    ...separateSiblings(shuffled(fresh, random)),
  ];
  return ordered.map((card) => ({
    id: crypto.randomUUID(),
    cardId: card.id,
    availableAt: isLearningCard(card) ? new Date(card.fsrs.due).getTime() : now,
  }));
}

function getActiveQueueIndex(queue: QueueEntry[], now: number): number {
  const dueIndex = queue.findIndex((entry) => entry.availableAt <= now);
  if (dueIndex >= 0) return dueIndex;
  if (!queue.length) return -1;
  const earliestAt = Math.min(...queue.map((entry) => entry.availableAt));
  if (earliestAt <= now + LEARN_AHEAD_MS) {
    return queue.findIndex((entry) => entry.availableAt === earliestAt);
  }
  return -1;
}

function isLearningCard(card: LearningCard): boolean {
  return card.fsrs.state === State.Learning || card.fsrs.state === State.Relearning;
}

function formatWaitTime(waitMs: number): string {
  const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
  if (minutes < 60) return `${minutes}분`;
  return `${Math.ceil(minutes / 60)}시간`;
}

function DictionaryAnswer({ card }: { card: LearningCard }): ReactElement {
  const lexical = card.lexicalData;
  if (lexical?.kind === 'kanji') {
    const target = lexical.articleTargets.find(
      (candidate) => candidate.characterReading === card.reading,
    ) ?? lexical.articleTargets[0];
    return (
      <div className="studyDictionaryAnswer">
        <div className="studyDictionaryContext">
          <span>이번 기사에서</span>
          <p lang="ja">
            {target ? `${target.word}（${target.wordReading}）` : card.exampleJa}
            <strong>{target?.characterReading ?? card.reading}</strong>
          </p>
          <small>{target?.meaningKoInContext ?? card.meaningKo}</small>
        </div>
        <dl className="studyKanjiReadings">
          <div>
            <dt>音読み</dt>
            <dd lang="ja">{lexical.onReadings.join(' · ') || '—'}</dd>
          </div>
          <div>
            <dt>訓読み</dt>
            <dd lang="ja">{lexical.kunReadings.join(' · ') || '—'}</dd>
          </div>
          <div>
            <dt>핵심 뜻</dt>
            <dd>{lexical.meaningsKo.join(' · ') || card.meaningKo}</dd>
          </div>
        </dl>
        <p className="studyDictionarySource">
          <a href="https://www.edrdg.org/" target="_blank" rel="noreferrer">EDRDG · KANJIDIC2</a>
          {' · '}{lexical.dictionaryRef.sourceVersion}
        </p>
      </div>
    );
  }

  if (lexical?.kind === 'word') {
    const alternateReadings = lexical.readings.filter(
      (reading) => reading !== lexical.selectedReading,
    );
    return (
      <div className="studyDictionaryAnswer">
        <p className="studyCardReading" lang="ja">{lexical.selectedReading}</p>
        <p className="studyCardMeaning">{lexical.meaningKoInContext}</p>
        <dl className="studyWordDictionary">
          <div>
            <dt>사전형</dt>
            <dd lang="ja">{lexical.dictionaryForm}</dd>
          </div>
          {alternateReadings.length ? (
            <div>
              <dt>다른 읽기</dt>
              <dd lang="ja">{alternateReadings.join(' · ')}</dd>
            </div>
          ) : null}
        </dl>
        <div className="studyWordSenses">
          <span>사전 뜻</span>
          <ol>
            {lexical.senses.map((sense) => (
              <li
                key={sense.id}
                className={lexical.selectedSenseIds.includes(sense.id) ? 'studyWordSenseActive' : ''}
              >
                {sense.meaningKo || sense.glossesEn.join('; ')}
                {lexical.selectedSenseIds.includes(sense.id) ? <small>이 기사</small> : null}
              </li>
            ))}
          </ol>
        </div>
        {card.exampleJa ? <p className="studyCardExample" lang="ja">{card.exampleJa}</p> : null}
        <p className="studyDictionarySource">
          <a href="https://www.edrdg.org/" target="_blank" rel="noreferrer">EDRDG · JMdict</a>
          {' · '}{lexical.dictionaryRef.sourceVersion}
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="studyCardReading" lang="ja">{card.reading}</p>
      <p className="studyCardMeaning">{card.meaningKo}</p>
      {card.exampleJa ? <p className="studyCardExample" lang="ja">{card.exampleJa}</p> : null}
    </div>
  );
}

function ActiveReview({
  card,
  remaining,
  attempts,
  progress,
  onRate,
  onExclude,
}: ActiveReviewProps): ReactElement {
  const [answerShown, setAnswerShown] = useState(false);
  const [ratingPending, setRatingPending] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const [reviewedAt] = useState(() => new Date());
  const previews = useMemo(() => getRatingPreview(card, reviewedAt), [card, reviewedAt]);
  const kanjiTarget = card.lexicalData?.kind === 'kanji'
    ? card.lexicalData.articleTargets.find(
        (candidate) => candidate.characterReading === card.reading,
      ) ?? card.lexicalData.articleTargets[0]
    : null;

  const rate = (rating: Grade): void => {
    if (!answerShown || ratingPending) return;
    setRatingPending(true);
    onRate(rating, startedAt, reviewedAt);
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
        <p>남은 카드 {remaining} · 시도 {attempts + 1}</p>
      </header>

      <div className="studyReviewProgress" aria-hidden="true">
        <span style={{ transform: `scaleX(${progress / 100})` }} />
      </div>

      <main className="studyReviewStage">
        <section className="studyFlashcard" aria-live="polite">
          <div className="studyCardTopline">
            <span>{card.sourceLabel}</span>
            <div>
              <span>복습 {card.fsrs.reps}회</span>
              <button type="button" onClick={onExclude}>학습 제외</button>
            </div>
          </div>
          <p
            className={card.kind === 'kanji' ? 'studyCardKanji' : 'studyCardWord'}
            lang="ja"
          >
            {card.front}
          </p>
          {kanjiTarget ? (
            <p className="studyKanjiPrompt" lang="ja">
              <span>기사 단어</span>
              <strong>{kanjiTarget.word}</strong>
            </p>
          ) : null}

          <div
            className={`studyAnswerReveal ${answerShown ? 'studyAnswerRevealOpen' : ''}`}
            aria-hidden={!answerShown}
          >
            {answerShown ? <DictionaryAnswer card={card} /> : null}
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
                    {preview ? formatDueInterval(preview.due, reviewedAt) : '계산 중'} · {index + 1}
                  </small>
                </button>
              );
            })}
          </div>
        )}
        {answerShown ? (
          <div className="studyReviewFootnotes">
            <p>틀렸다면 ‘겨우 맞음’이 아니라 반드시 ‘모름’을 누릅니다.</p>
            <p>예정 간격은 카드별 기억 상태와 복습일 분산 때문에 서로 다릅니다.</p>
          </div>
        ) : null}
      </footer>
    </div>
  );
}

export function ReviewSession({
  cards,
  onRate,
  onExclude,
  onOpenLibrary,
}: ReviewSessionProps): ReactElement {
  const [sessionSeed] = useState(() => crypto.randomUUID());
  const [startedAt] = useState(() => Date.now());
  const [queue, setQueue] = useState<QueueEntry[]>(() =>
    createSessionQueue(cards, startedAt, sessionSeed),
  );
  const [attempts, setAttempts] = useState(0);
  const [settledIds, setSettledIds] = useState<Set<string>>(() => new Set());
  const [excludedCount, setExcludedCount] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [sessionTotal] = useState(() => new Set(queue.map((entry) => entry.cardId)).size);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const activeIndex = getActiveQueueIndex(queue, clock);
  const activeEntry = activeIndex >= 0 ? queue[activeIndex] : null;
  const activeCard = activeEntry
    ? cards.find((card) => card.id === activeEntry.cardId && isStudyable(card)) ?? null
    : null;
  const remaining = new Set(queue.map((entry) => entry.cardId)).size;
  const progress = sessionTotal === 0 ? 100 : (settledIds.size / sessionTotal) * 100;
  const nextAt = queue.length ? Math.min(...queue.map((entry) => entry.availableAt)) : null;

  if (!activeCard || !activeEntry) {
    const waiting = queue.length > 0 && nextAt !== null;
    return (
      <div className="studyPage studyReviewPage">
        <header className="studyReviewHeader">
          <p className="studyKicker">TODAY · REVIEW</p>
          <span>{attempts}회 확인{excludedCount ? ` · ${excludedCount}개 제외` : ''}</span>
        </header>
        <section className="studyReviewComplete" aria-live="polite">
          <span className="studyCompletionGlyph" aria-hidden="true">{waiting ? '待' : '済'}</span>
          <h1>{waiting ? '다음 확인을 기다리고 있습니다.' : '오늘 카드는 끝났습니다.'}</h1>
          <p>
            {waiting && nextAt !== null
              ? `${formatWaitTime(nextAt - clock)} 뒤에 다시 확인할 카드가 있습니다.`
              : '모른 카드는 기억한 것으로 답할 때까지 세션 안에서 다시 확인했습니다.'}
          </p>
          <button type="button" onClick={onOpenLibrary}>전체 카드 보기</button>
        </section>
      </div>
    );
  }

  return (
    <ActiveReview
      key={activeEntry.id}
      card={activeCard}
      remaining={remaining}
      attempts={attempts}
      progress={progress}
      onExclude={() => {
        onExclude(activeCard.id);
        setQueue((current) => current.filter((entry) => entry.cardId !== activeCard.id));
        setSettledIds((current) => new Set(current).add(activeCard.id));
        setExcludedCount((value) => value + 1);
      }}
      onRate={(rating, cardStartedAt, reviewedAt) => {
        const updated = onRate(activeCard.id, rating, cardStartedAt, reviewedAt);
        if (!updated) return;
        setAttempts((value) => value + 1);
        setQueue((current) => {
          const remainingEntries = current.filter((entry) => entry.id !== activeEntry.id);
          if (!isLearningCard(updated)) return remainingEntries;
          return [
            ...remainingEntries,
            {
              id: crypto.randomUUID(),
              cardId: updated.id,
              availableAt: new Date(updated.fsrs.due).getTime(),
            },
          ];
        });
        if (!isLearningCard(updated)) {
          setSettledIds((current) => new Set(current).add(updated.id));
        }
        setClock(Date.now());
      }}
    />
  );
}

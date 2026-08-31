import { useMemo, useState, type ReactElement } from 'react';
import type { CardKind, LearningCard } from './model';

type CardFilter = 'all' | CardKind | 'excluded';

interface CardLibraryProps {
  cards: LearningCard[];
  onToggleSuspend: (cardId: string) => void;
  onExclude: (cardId: string) => void;
  onStartReview: () => void;
}

function formatDue(value: string): string {
  const due = new Date(value);
  const now = new Date();
  if (due.getTime() <= now.getTime()) return '오늘';
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
  }).format(due);
}

function sourceCount(card: LearningCard): number {
  return new Set([
    ...(card.sourceArticleIds ?? []),
    ...(card.sourceArticleId ? [card.sourceArticleId] : []),
  ]).size;
}

export function CardLibrary({
  cards,
  onToggleSuspend,
  onExclude,
  onStartReview,
}: CardLibraryProps): ReactElement {
  const [filter, setFilter] = useState<CardFilter>('all');
  const [clock] = useState(() => Date.now());
  const visibleCards = useMemo(
    () =>
      cards
        .filter((card) => {
          if (filter === 'all') return true;
          if (filter === 'excluded') return card.learningState === 'excluded';
          return card.kind === filter && card.learningState !== 'excluded';
        })
        .sort((a, b) => a.front.localeCompare(b.front, 'ja')),
    [cards, filter],
  );
  const dueCount = cards.filter(
    (card) =>
      !card.suspended
      && card.learningState !== 'excluded'
      && new Date(card.fsrs.due).getTime() <= clock,
  ).length;

  return (
    <div className="studyPage studyLibraryPage">
      <header className="studyPageLead">
        <div>
          <p className="studyKicker">LIBRARY · {cards.length} CARDS</p>
          <h1>단어와 한자를 따로 관리합니다.</h1>
        </div>
        <button type="button" className="studyPrimaryButton" onClick={onStartReview}>
          오늘 복습 {dueCount}개
        </button>
      </header>

      <div className="studyLibraryFilters" role="group" aria-label="카드 종류 필터">
        {([
          ['all', '전체'],
          ['word', '단어'],
          ['kanji', '한자 1글자'],
          ['excluded', '제외됨'],
        ] as const).map(([value, label]) => (
          <button
            type="button"
            key={value}
            className={filter === value ? 'studyFilterActive' : ''}
            onClick={() => setFilter(value)}
          >
            {label}
            <span>
              {value === 'all'
                ? cards.length
                : value === 'excluded'
                  ? cards.filter((card) => card.learningState === 'excluded').length
                  : cards.filter(
                      (card) => card.kind === value && card.learningState !== 'excluded',
                    ).length}
            </span>
          </button>
        ))}
      </div>

      <div className="studyLibraryTable" role="table" aria-label="학습 카드">
        <div className="studyLibraryRow studyLibraryHead" role="row">
          <span role="columnheader">표기</span>
          <span role="columnheader">읽기와 뜻</span>
          <span role="columnheader">다음 복습</span>
          <span role="columnheader">상태</span>
        </div>
        {visibleCards.map((card) => (
          <div
            className={`studyLibraryRow ${card.suspended ? 'studyLibraryRowSuspended' : ''}`}
            role="row"
            key={card.id}
          >
            <div role="cell" className="studyLibraryFront">
              <span>{card.kind === 'kanji' ? 'KANJI' : 'WORD'}</span>
              <strong lang="ja">{card.front}</strong>
            </div>
            <div role="cell" className="studyLibraryAnswer">
              <span lang="ja">{card.reading}</span>
              <p>{card.meaningKo}</p>
              {card.lexicalData?.kind === 'kanji' ? (
                <small lang="ja">
                  音 {card.lexicalData.onReadings.join(' · ') || '—'} ／ 訓{' '}
                  {card.lexicalData.kunReadings.join(' · ') || '—'}
                </small>
              ) : null}
              <small>{sourceCount(card)}개 기사에서 표시</small>
            </div>
            <div role="cell" className="studyLibraryDue">
              <strong>
                {card.learningState === 'excluded'
                  ? '학습 제외'
                  : card.suspended
                    ? '일시 정지'
                    : formatDue(card.fsrs.due)}
              </strong>
              <span>{card.fsrs.reps}회 복습</span>
            </div>
            <div role="cell" className="studyLibraryControl">
              <button type="button" onClick={() => onToggleSuspend(card.id)}>
                {card.suspended ? '다시 포함' : '일시 정지'}
              </button>
              {!card.suspended ? (
                <button type="button" onClick={() => onExclude(card.id)}>학습 제외</button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

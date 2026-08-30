import type { LearningCard, StudyWorkspace } from './model';
import { createSerializableFsrsCard } from './scheduler';

function demoCard(
  id: string,
  kind: LearningCard['kind'],
  front: string,
  reading: string,
  meaningKo: string,
  exampleJa: string,
): LearningCard {
  return {
    id,
    kind,
    canonicalKey: kind === 'kanji' ? front : `${front}|${reading}`,
    front,
    reading,
    meaningKo,
    exampleJa,
    sourceArticleId: 'demo-article',
    sourceArticleIds: ['demo-article'],
    sourceLabel: '개발용 미리보기',
    initialKind: 'context_guess',
    suspended: false,
    revision: 0,
    fsrs: createSerializableFsrsCard(),
  };
}

export function createDemoWorkspace(): StudyWorkspace {
  const now = new Date().toISOString();
  return {
    version: 1,
    articles: [
      {
        id: 'demo-article',
        dayNo: 1,
        title: '첫 실제 기사 불러오기',
        publisher: '개발용 미리보기',
        sourceUrl: '',
        publishedAt: now.slice(0, 10),
        bodyText:
          '企業は新しい事業への投資方針を発表した。市場への影響を見ながら、導入時期を調整する。',
        annotations: [
          {
            id: 'demo-annotation-1',
            start: 12,
            end: 14,
            quote: '方針',
            kind: 'context_guess',
            note: '',
          },
          {
            id: 'demo-annotation-2',
            start: 24,
            end: 26,
            quote: '影響',
            kind: 'reading_unknown',
            note: '',
          },
        ],
        bodyRevision: 1,
      },
    ],
    responses: [
      {
        id: 'demo-response-1',
        articleId: 'demo-article',
        ordinal: 1,
        perspective: '무슨 일인가',
        prompt: '기사에서 기업이 발표한 결정은 무엇인가?',
        answer: '',
        referenceAnswer: '',
        feedback: '',
      },
      {
        id: 'demo-response-2',
        articleId: 'demo-article',
        ordinal: 2,
        perspective: '어떤 변수인가',
        prompt: '실행 시기를 정할 때 무엇을 고려하는가?',
        answer: '',
        referenceAnswer: '',
        feedback: '',
      },
    ],
    cards: [
      demoCard('demo-word-1', 'word', '方針', 'ほうしん', '방침', '投資方針を発表する'),
      demoCard('demo-kanji-1', 'kanji', '針', 'しん', '바늘, 방향의 기준', '方針・指針'),
      demoCard('demo-word-2', 'word', '影響', 'えいきょう', '영향', '市場への影響を見る'),
      demoCard('demo-kanji-2', 'kanji', '響', 'きょう', '울리다, 영향을 미치다', '影響・反響'),
    ],
    reviewEvents: [],
    updatedAt: now,
  };
}

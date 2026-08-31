import type { CardLexicalData, LearningCard, StudyWorkspace } from './model';
import { createSerializableFsrsCard } from './scheduler';

function demoCard(
  id: string,
  kind: LearningCard['kind'],
  front: string,
  reading: string,
  meaningKo: string,
  exampleJa: string,
  lexicalData?: CardLexicalData,
): LearningCard {
  return {
    id,
    kind,
    canonicalKey: `${front}|${reading}`,
    front,
    reading,
    meaningKo,
    exampleJa,
    sourceArticleId: 'demo-article',
    sourceArticleIds: ['demo-article'],
    sourceLabel: '개발용 미리보기',
    initialKind: 'context_guess',
    suspended: false,
    learningState: 'active',
    lexicalData,
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
      demoCard(
        'demo-word-1',
        'word',
        '方針',
        'ほうしん',
        '방침',
        '投資方針を発表する',
        {
          kind: 'word',
          dictionaryRef: { source: 'jmdict', entryId: '1517040', sourceVersion: 'demo' },
          dictionaryForm: '方針',
          forms: ['方針', 'ほうしん'],
          readings: ['ほうしん'],
          senses: [
            {
              id: '1517040:1',
              partsOfSpeech: ['n'],
              glossesEn: ['policy', 'course', 'plan of action'],
              meaningKo: '방침; 행동 방향·계획·원칙',
            },
            {
              id: '1517040:2',
              partsOfSpeech: ['n'],
              glossesEn: ['magnetic needle'],
              meaningKo: '나침반의 자침',
            },
          ],
          selectedReading: 'ほうしん',
          selectedSenseIds: ['1517040:1'],
          meaningKoInContext: '방침',
        },
      ),
      demoCard(
        'demo-kanji-1',
        'kanji',
        '針',
        'しん',
        '바늘, 방향의 기준',
        '方針・指針',
        {
          kind: 'kanji',
          dictionaryRef: { source: 'kanjidic2', entryId: '針', sourceVersion: 'demo' },
          literal: '針',
          onReadings: ['シン'],
          kunReadings: ['はり'],
          nanoriReadings: [],
          meaningsEn: ['needle', 'pin', 'staple'],
          meaningsKo: ['바늘', '지침'],
          grade: 6,
          strokeCount: 10,
          articleTargets: [{
            word: '方針',
            wordReading: 'ほうしん',
            characterReading: 'しん',
            meaningKoInContext: '방침의 방향·기준을 나타냄',
            articleId: 'demo-article',
          }],
        },
      ),
      demoCard('demo-word-2', 'word', '影響', 'えいきょう', '영향', '市場への影響を見る'),
      demoCard('demo-kanji-2', 'kanji', '響', 'きょう', '울리다, 영향을 미치다', '影響・反響'),
    ],
    reviewEvents: [],
    updatedAt: now,
  };
}

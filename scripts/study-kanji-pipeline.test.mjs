import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildKanjiLexicalData,
  characterReadingFromFurigana,
  classifyKanjiReading,
  deriveKanjiArticleReading,
  hasCompleteKanjiDictionaryData,
  selectKanjiExampleWords,
} from '../src/study/kanjiLexicon.ts';
import { validateKanjiProposalPairs } from './study-grading.mjs';

const dictionary = {
  literal: '着',
  onReadings: ['チャク', 'ジャク'],
  kunReadings: ['き.る', 'つ.く'],
  nanoriReadings: [],
  koreanReadings: ['착'],
  meaningsEn: ['don', 'wear', 'arrive'],
  grade: 3,
  frequency: 376,
  strokeCount: 12,
};

test('article reading is classified against the complete on and kun lists', () => {
  assert.equal(classifyKanjiReading('ちゃく', dictionary), 'on');
  assert.equal(classifyKanjiReading('き', dictionary), 'kun');
  assert.equal(classifyKanjiReading('ちゃっ', dictionary), 'sound_change');
  assert.equal(classifyKanjiReading('ふめい', dictionary), 'other');
});

test('the deterministic builder normalizes facts and merges article targets idempotently', () => {
  const target = {
    word: '着工',
    wordReading: 'ちゃっこう',
    characterReading: 'ちゃく',
    meaningKoInContext: '착공',
    articleId: 'article-3',
    annotationId: 'annotation-3',
  };
  const first = buildKanjiLexicalData({
    literal: '着',
    meaningKo: '도착하다, 착수하다',
    targets: [target],
    exampleWords: [{
      word: '到着',
      wordReading: 'とうちゃく',
      characterReading: 'ちゃく',
      readingType: 'on',
    }],
  }, { ...dictionary, onReadings: ['チャク', ' チャク ', 'ジャク'] });
  const second = buildKanjiLexicalData({
    literal: '着',
    meaningKo: '덮어쓰지 않을 뜻',
    existingLexicalData: first,
    targets: [target],
  }, dictionary);

  assert.deepEqual(second.onReadings, ['チャク', 'ジャク']);
  assert.deepEqual(second.koreanReadings, ['착']);
  assert.deepEqual(second.meaningsKo, ['도착하다, 착수하다']);
  assert.equal(second.articleTargets.length, 1);
  assert.equal(second.articleTargets[0].readingType, 'on');
  assert.equal(second.pipelineVersion, 'kanji-card/v2');
  assert.equal(hasCompleteKanjiDictionaryData(second, '着', 'ちゃく'), true);
  assert.equal(hasCompleteKanjiDictionaryData(second, '着', 'き'), false);
  assert.equal(hasCompleteKanjiDictionaryData(second, '着', 'ふめい'), false);
  assert.equal(hasCompleteKanjiDictionaryData({ ...second, exampleWords: [] }, '着'), false);
});

test('a kanji card cannot be generated without a real article word and reading', () => {
  assert.throws(() => buildKanjiLexicalData({
    literal: '着',
    meaningKo: '착',
    targets: [],
  }, dictionary), /연결된 기사 단어/);
  assert.throws(() => buildKanjiLexicalData({
    literal: '着',
    meaningKo: '착',
    targets: [{
      word: '工事',
      wordReading: 'こうじ',
      characterReading: 'ちゃく',
      meaningKoInContext: '공사',
      articleId: 'article-3',
    }],
  }, dictionary), /기사 단어가 올바르지/);
});

test('grading rejects an unpaired or ambiguous kanji proposal before saving', () => {
  const kanji = {
    kind: 'kanji', front: '着', reading: 'ちゃく', source_type: 'annotation', source_id: 'a1',
  };
  const word = {
    kind: 'word', front: '着工', reading: 'ちゃっこう', source_type: 'annotation', source_id: 'a1',
  };
  assert.doesNotThrow(() => validateKanjiProposalPairs([kanji, word]));
  assert.throws(() => validateKanjiProposalPairs([kanji]), /정확히 하나/);
  assert.throws(() => validateKanjiProposalPairs([kanji, word, { ...word, front: '着手' }]), /현재 2개/);
});

test('Jotoba furigana is split only when ruby parts map one-to-one to kanji', () => {
  assert.equal(characterReadingFromFurigana('着', '[着工|ちゃっ|こう]'), 'ちゃっ');
  assert.equal(characterReadingFromFurigana('乗', '[名乗|な|の]る'), 'の');
  assert.equal(characterReadingFromFurigana('積', '[上積|うわ|づ]み'), 'づ');
  assert.equal(characterReadingFromFurigana('今', '[今日|きょう]'), null);
});

test('article reading comes from the matched word ruby while the card keeps its base reading', () => {
  assert.equal(deriveKanjiArticleReading(
    '着', 'ちゃく', '着工', 'ちゃっこう', dictionary,
    [{
      word: '着工', wordReading: 'ちゃっこう', furigana: '[着工|ちゃっ|こう]', common: true, sourceIndex: 0,
    }],
  ), 'ちゃっ');
  assert.equal(deriveKanjiArticleReading(
    '着', 'き', '着工', 'ちゃっこう', dictionary,
    [{
      word: '着工', wordReading: 'ちゃっこう', furigana: '[着工|ちゃっ|こう]', common: true, sourceIndex: 0,
    }],
  ), null);
  assert.equal(deriveKanjiArticleReading(
    '着', 'ちゃく', '着工', 'ちゃくこう', dictionary,
    [{
      word: '着工', wordReading: 'ちゃっこう', furigana: '[着工|ちゃっ|こう]', common: true, sourceIndex: 0,
    }],
  ), null);
  assert.equal(deriveKanjiArticleReading(
    '超', 'こ', '超える', 'こえる',
    { ...dictionary, literal: '超', onReadings: ['チョウ'], kunReadings: ['こ.える', 'こ.す'] },
    [],
  ), 'こ');
});

test('example selection prefers a common two-kanji word with the same reading type', () => {
  const examples = selectKanjiExampleWords('着', 'ちゃく', dictionary, ['着工'], [
    {
      word: '着る', wordReading: 'きる', furigana: '[着|き]る', common: true, sourceIndex: 0,
    },
    {
      word: '到着', wordReading: 'とうちゃく', furigana: '[到着|とう|ちゃく]', common: true, sourceIndex: 1,
    },
    {
      word: '着色', wordReading: 'ちゃくしょく', furigana: '[着色|ちゃく|しょく]', common: false, sourceIndex: 2,
    },
  ]);
  assert.deepEqual(examples, [{
    word: '到着',
    wordReading: 'とうちゃく',
    characterReading: 'ちゃく',
    readingType: 'on',
  }]);
});

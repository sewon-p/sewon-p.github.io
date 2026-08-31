#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const HELP = `일본어 학습 카드 사전 보강

사용법:
  npm run --silent study:lexicon -- \\
    --jmdict /path/to/jmdict-eng.json \\
    --kanjidic /path/to/kanjidic2-en.json [--apply]

JMdict와 KANJIDIC2의 form-reading-sense 구조를 카드의 lexical_data에
스냅샷으로 저장합니다. --apply를 빼면 매칭 결과만 출력합니다.

환경 변수(--apply에서 필요):
  SUPABASE_SECRET_KEY
  SUPABASE_URL 또는 VITE_SUPABASE_URL`;

const WORD_SENSE_SELECTION = new Map([
  ['上積み', [1]],
  ['北側', [0]],
  ['投入', [2]],
  ['拡張', [0]],
  ['撤回', [0]],
  ['整備', [1]],
  ['敷地', [0]],
  ['方針', [0]],
  ['経緯', [0]],
  ['見通し', [1]],
  ['調整', [0]],
  ['跡地', [0]],
  ['躍進', [0]],
  ['面積', [0]],
  ['首位', [0]],
]);

const WORD_SENSES_KO = {
  上積み: ['위에 짐을 더 얹음; 갑판 화물', '추가함; 수량을 더 늘림'],
  北側: ['북쪽; 북측'],
  投入: ['던져 넣음; 삽입·투입', '자금·인력 투입', '제품·서비스의 시장 투입·출시', '컴퓨터 작업·명령 입력'],
  拡張: ['확장; 확대', 'Escape 키(컴퓨터)'],
  撤回: ['철회; 취소; 번복'],
  整備: ['정비; 점검·유지보수', '시설·체계를 갖춤; 조성·개선'],
  敷地: ['부지; 건물·시설이 자리한 땅'],
  方針: ['방침; 행동 방향·계획·원칙', '나침반의 자침'],
  経緯: ['경위; 일이 그렇게 된 과정', '경도와 위도', '날실과 씨실'],
  見通し: ['탁 트인 시야; 조망', '전망; 예측', '통찰; 선견지명'],
  調整: ['조정; 조율; 조절'],
  跡地: ['이전 건물·시설이 있던 터'],
  躍進: ['약진; 크게 도약함'],
  面積: ['면적; 넓이'],
  首位: ['수위; 첫째 자리; 1위'],
  日本製鉄: ['일본제철(회사명)'],
};

const KANJI_MEANINGS_KO = {
  上: ['위', '오르다', '더하다'],
  位: ['자리', '지위', '순위'],
  側: ['쪽', '곁', '측면'],
  備: ['갖추다', '준비하다'],
  入: ['들어가다', '넣다'],
  北: ['북쪽'],
  回: ['돌다', '횟수', '되돌리다'],
  地: ['땅', '지역'],
  場: ['장소', '현장'],
  張: ['펴다', '치다', '넓히다'],
  投: ['던지다', '투입하다'],
  拡: ['넓히다', '확대하다'],
  撤: ['거두다', '철수하다'],
  整: ['가지런히 하다', '정돈하다'],
  敷: ['깔다', '펼치다'],
  方: ['방향', '방법'],
  積: ['쌓다', '누적하다'],
  経: ['지나가다', '경영하다'],
  緯: ['씨줄', '위도', '경위'],
  見: ['보다', '보이다'],
  調: ['조사하다', '조절하다'],
  跡: ['흔적', '자취', '옛터'],
  躍: ['뛰다', '도약하다'],
  通: ['통하다', '지나다'],
  進: ['나아가다'],
  針: ['바늘', '지침'],
  鉄: ['철'],
  面: ['얼굴', '면', '방면'],
  首: ['목', '우두머리'],
};

const ARTICLE_TARGETS = {
  上: ['上積み', 'うわづみ', 'うわ'],
  位: ['首位', 'しゅい', 'い'],
  側: ['北側', 'きたがわ', 'がわ'],
  備: ['整備', 'せいび', 'び'],
  入: ['投入', 'とうにゅう', 'にゅう'],
  北: ['北側', 'きたがわ', 'きた'],
  回: ['撤回', 'てっかい', 'かい'],
  地: ['敷地', 'しきち', 'ち'],
  場: ['工場', 'こうじょう', 'じょう'],
  張: ['拡張', 'かくちょう', 'ちょう'],
  投: ['投入', 'とうにゅう', 'とう'],
  拡: ['拡張', 'かくちょう', 'かく'],
  撤: ['撤回', 'てっかい', 'てっ'],
  整: ['調整', 'ちょうせい', 'せい'],
  敷: ['敷地', 'しきち', 'しき'],
  方: ['方針', 'ほうしん', 'ほう'],
  積: ['上積み', 'うわづみ', 'づみ'],
  経: ['経緯', 'けいい', 'けい'],
  緯: ['経緯', 'けいい', 'い'],
  見: ['見通し', 'みとおし', 'み'],
  調: ['調整', 'ちょうせい', 'ちょう'],
  跡: ['跡地', 'あとち', 'あと'],
  躍: ['躍進', 'やくしん', 'やく'],
  通: ['見通し', 'みとおし', 'とお'],
  進: ['躍進', 'やくしん', 'しん'],
  針: ['方針', 'ほうしん', 'しん'],
  鉄: ['日本製鉄', 'にっぽんせいてつ', 'てつ'],
  面: ['面積', 'めんせき', 'めん'],
  首: ['首位', 'しゅい', 'しゅ'],
};

class CliError extends Error {}

function parseArguments(argv) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) return { help: true };
  const options = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--apply') {
      options.apply = true;
      continue;
    }
    if (!['--jmdict', '--kanjidic'].includes(item)) {
      throw new CliError(`알 수 없는 옵션: ${item}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new CliError(`${item} 경로가 필요합니다.`);
    options[item.slice(2)] = value;
    index += 1;
  }
  if (!options.jmdict || !options.kanjidic) {
    throw new CliError('--jmdict와 --kanjidic 경로가 모두 필요합니다.');
  }
  return options;
}

async function readDictionary(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : '읽기 실패';
    throw new CliError(`${label}을 읽지 못했습니다: ${message}`);
  }
}

function createServiceClient() {
  const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').trim();
  const key = (process.env.SUPABASE_SECRET_KEY ?? '').trim();
  if (!url || !key) throw new CliError('Supabase URL과 service-role secret이 필요합니다.');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function entryReadings(entry, front) {
  return entry.kana
    .filter(
      (item) => item.appliesToKanji.includes('*') || item.appliesToKanji.includes(front),
    )
    .map((item) => item.text);
}

function findWordEntry(entries, front, reading) {
  return entries.find(
    (entry) =>
      entry.kanji.some((item) => item.text === front)
      && entryReadings(entry, front).includes(reading),
  );
}

function createWordData(card, entry, jmdict) {
  if (!entry) {
    return {
      kind: 'word',
      dictionaryRef: {
        source: 'custom',
        entryId: `article:${card.canonical_key}`,
        sourceVersion: `curated-${jmdict.dictDate}`,
      },
      dictionaryForm: card.front,
      forms: [card.front],
      readings: [card.reading],
      senses: [{
        id: 'context-1',
        partsOfSpeech: [],
        glossesEn: [],
        meaningKo: card.meaning_ko ?? '',
      }],
      selectedReading: card.reading,
      selectedSenseIds: ['context-1'],
      meaningKoInContext: card.meaning_ko ?? '',
    };
  }

  const requestedSenseIndexes = WORD_SENSE_SELECTION.get(card.front) ?? [0];
  const koreanSenses = WORD_SENSES_KO[card.front] ?? [];
  const senses = entry.sense.map((sense, index) => ({
    id: `${entry.id}:${index + 1}`,
    partsOfSpeech: sense.partOfSpeech,
    glossesEn: sense.gloss.filter((gloss) => gloss.lang === 'eng').map((gloss) => gloss.text),
    meaningKo:
      koreanSenses[index]
      ?? (requestedSenseIndexes.includes(index) ? card.meaning_ko ?? '' : ''),
  }));
  return {
    kind: 'word',
    dictionaryRef: {
      source: 'jmdict',
      entryId: entry.id,
      sourceVersion: `${jmdict.version}/${jmdict.dictDate}`,
    },
    dictionaryForm: entry.kanji.find((item) => item.text === card.front)?.text ?? card.front,
    forms: [...new Set([...entry.kanji.map((item) => item.text), ...entry.kana.map((item) => item.text)])],
    readings: [...new Set(entryReadings(entry, card.front))],
    senses,
    selectedReading: card.reading,
    selectedSenseIds: requestedSenseIndexes
      .map((index) => senses[index]?.id)
      .filter(Boolean),
    meaningKoInContext: card.meaning_ko ?? '',
  };
}

function createKanjiData(card, entry, articleId, kanjidic) {
  const groups = entry.readingMeaning?.groups ?? [];
  const readings = groups.flatMap((group) => group.readings ?? []);
  const meaningsEn = groups.flatMap((group) =>
    (group.meanings ?? [])
      .filter((meaning) => meaning.lang === 'en')
      .map((meaning) => meaning.value),
  );
  const [word, wordReading, characterReading] = ARTICLE_TARGETS[card.front] ?? [
    card.example_ja || card.front,
    '',
    card.reading,
  ];
  return {
    kind: 'kanji',
    dictionaryRef: {
      source: 'kanjidic2',
      entryId: card.front,
      sourceVersion: `${kanjidic.version}/${kanjidic.databaseVersion}/${kanjidic.dictDate}`,
    },
    literal: card.front,
    onReadings: readings
      .filter((reading) => reading.type === 'ja_on')
      .map((reading) => reading.value),
    kunReadings: readings
      .filter((reading) => reading.type === 'ja_kun')
      .map((reading) => reading.value),
    nanoriReadings: entry.readingMeaning?.nanori ?? [],
    meaningsEn,
    meaningsKo: KANJI_MEANINGS_KO[card.front] ?? [card.meaning_ko ?? ''],
    ...(entry.misc?.grade ? { grade: entry.misc.grade } : {}),
    ...(entry.misc?.frequency ? { frequency: entry.misc.frequency } : {}),
    ...(entry.misc?.strokeCounts?.[0] ? { strokeCount: entry.misc.strokeCounts[0] } : {}),
    articleTargets: [{
      word,
      wordReading,
      characterReading,
      meaningKoInContext: card.meaning_ko ?? '',
      articleId: articleId ?? null,
    }],
  };
}

async function loadCards(client) {
  const { data: cards, error: cardError } = await client
    .from('study_cards')
    .select('id,user_id,kind,canonical_key,front,reading,meaning_ko,example_ja')
    .order('kind')
    .order('front');
  if (cardError) throw new CliError(`카드를 읽지 못했습니다: ${cardError.message}`);
  const { data: sources, error: sourceError } = await client
    .from('study_card_sources')
    .select('card_id,article_id');
  if (sourceError) throw new CliError(`카드 출처를 읽지 못했습니다: ${sourceError.message}`);
  const sourceByCard = new Map();
  for (const source of sources ?? []) {
    if (!sourceByCard.has(source.card_id)) sourceByCard.set(source.card_id, source.article_id);
  }
  return { cards: cards ?? [], sourceByCard };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const [jmdict, kanjidic] = await Promise.all([
    readDictionary(options.jmdict, 'JMdict'),
    readDictionary(options.kanjidic, 'KANJIDIC2'),
  ]);
  const client = createServiceClient();
  const { cards, sourceByCard } = await loadCards(client);
  const kanjiByLiteral = new Map(kanjidic.characters.map((entry) => [entry.literal, entry]));
  const updates = cards.map((card) => {
    if (card.kind === 'kanji') {
      const entry = kanjiByLiteral.get(card.front);
      if (!entry) throw new CliError(`KANJIDIC2에서 ${card.front}을 찾지 못했습니다.`);
      const targetReading = ARTICLE_TARGETS[card.front]?.[2] ?? card.reading;
      const storedReading = card.front === '積' ? targetReading : card.reading;
      return {
        card,
        reading: storedReading,
        canonicalKey: `${card.front}|${storedReading}`,
        lexicalData: createKanjiData(card, entry, sourceByCard.get(card.id), kanjidic),
        matched: true,
      };
    }
    const entry = findWordEntry(jmdict.words, card.front, card.reading);
    return {
      card,
      reading: card.reading,
      canonicalKey: card.canonical_key,
      lexicalData: createWordData(card, entry, jmdict),
      matched: Boolean(entry),
    };
  });

  if (options.apply) {
    for (const update of updates) {
      const { error } = await client
        .from('study_cards')
        .update({
          reading: update.reading,
          canonical_key: update.canonicalKey,
          lexical_data: update.lexicalData,
        })
        .eq('id', update.card.id)
        .eq('user_id', update.card.user_id);
      if (error) throw new CliError(`${update.card.front} 저장 실패: ${error.message}`);
    }
  }

  const summary = {
    mode: options.apply ? 'applied' : 'preview',
    dictionaryDate: jmdict.dictDate,
    cards: updates.length,
    jmdictMatched: updates.filter((update) => update.card.kind === 'word' && update.matched).length,
    customWords: updates.filter((update) => update.card.kind === 'word' && !update.matched).map(
      (update) => update.card.front,
    ),
    kanjiMatched: updates.filter((update) => update.card.kind === 'kanji' && update.matched).length,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : '알 수 없는 오류';
  process.stderr.write(`오류: ${message}\n`);
  process.exitCode = 1;
});

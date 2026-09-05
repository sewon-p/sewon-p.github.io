import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lookupJotoba } from '../src/study/dictionary.ts';

function setup(t, respond) {
  const storage = new Map();
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const query = JSON.parse(options.body).query;
    requests.push({ url, query });
    return respond(url, query);
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      setTimeout,
      clearTimeout,
      localStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
    },
  });
  t.after(() => { delete globalThis.window; });
  return { requests, storage };
}

test('a single kanji uses its dedicated endpoint even if word search returns a different spelling', async (t) => {
  const { requests } = setup(t, (url) => Response.json(url.endsWith('/kanji')
    ? { kanji: [
        { literal: '緯', onyomi: ['イ'], kunyomi: ['よこいと'], korean_h: ['위'], stroke_count: 16 },
        { literal: '横', onyomi: ['オウ'] },
      ] }
    : { words: [{ reading: { kanji: '横糸', kana: 'よこいと' }, senses: [{ glosses: ['weft'] }] }] }));
  const results = await lookupJotoba('緯');
  assert.equal(requests.length, 2);
  assert.equal(results[0].literal, '緯');
  assert.deepEqual(results[0].onReadings, ['イ']);
  assert.deepEqual(results[0].koreanReadings, ['위']);
  assert.equal(results[0].strokeCount, 16);
  assert.equal(results.some((item) => item.literal === '横'), false);
  await lookupJotoba('緯');
  assert.equal(requests.length, 2, 'repeated search uses the cached result');
});

test('kana lookup makes one request and compound words stay ahead of their characters', async (t) => {
  const { requests } = setup(t, (url) => Response.json(url.endsWith('/kanji')
    ? { kanji: [{ literal: '上', onyomi: ['ジョウ'] }] }
    : { words: [{ reading: { kanji: '上げる', kana: 'あげる' }, senses: [{ glosses: ['to raise'] }] }] }));
  await lookupJotoba('あげる');
  assert.equal(requests.length, 1);
  const results = await lookupJotoba('上げる');
  assert.equal(results[0].headword, '上げる');
  assert.equal(results[1].literal, '上');
});

test('failed or malformed dictionary responses are not saved as successful empty searches', async (t) => {
  let broken = true;
  const { storage } = setup(t, () => broken
    ? Response.json({ error: 'unavailable' })
    : Response.json({ words: [] }));
  await assert.rejects(lookupJotoba('てすと'), /사전 응답/);
  assert.equal(storage.size, 0);
  broken = false;
  assert.deepEqual(await lookupJotoba('てすと'), []);
  assert.equal(storage.size, 0);
});

test('an oversized article selection never reaches the public dictionary', async (t) => {
  const { requests } = setup(t, () => Response.json({ words: [] }));
  await assert.rejects(lookupJotoba('あ'.repeat(81)), /80자/);
  assert.equal(requests.length, 0);
});

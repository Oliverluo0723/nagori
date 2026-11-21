import { expect, test } from 'vitest';
import { BEAT_STEPS, beatHits, nextBeats } from './beat';

const STEP = 0.125; // 120 BPM 的 16 分音符

test('一小節：kick 第 1、7、9 格，snare 第 5、13 格，hat 每兩格', () => {
  const hits = beatHits(0, 2);
  const at = (kind: string) => hits.filter((h) => h.kind === kind).map((h) => h.time / STEP);
  expect(at('kick')).toEqual([0, 6, 8]);
  expect(at('snare')).toEqual([4, 12]);
  expect(at('hat')).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
  expect(BEAT_STEPS).toBe(16);
});

test('範圍是 [from, to)：接著要的時候不重複也不漏', () => {
  const a = beatHits(0, 1.3);
  const b = beatHits(1.3, 4);
  expect([...a, ...b]).toEqual(beatHits(0, 4));
});

test('第二小節照樣循環，依時間排序', () => {
  const hits = beatHits(2, 4);
  expect(hits[0]).toMatchObject({ time: 2, kind: 'kick' });
  const times = hits.map((h) => h.time);
  expect(times).toEqual([...times].sort((x, y) => x - y));
});

test('負的或空的範圍沒有拍子', () => {
  expect(beatHits(-1, 0)).toEqual([]);
  expect(beatHits(1, 1)).toEqual([]);
});

test('預排：每次排到 now + 0.1 秒，接著上次排到的地方', () => {
  const a = nextBeats(0, 0);
  expect(a.until).toBeCloseTo(0.1);
  expect(a.hits).toEqual(beatHits(0, 0.1));
  const b = nextBeats(a.until, 0.03);
  expect(b.hits).toEqual(beatHits(0.1, 0.13));
});

test('預排：落後太多（分頁在背景）就丟掉，不補一串', () => {
  const r = nextBeats(0.1, 5);
  expect(r.hits.every((h) => h.time >= 5 - 0.05)).toBe(true);
  expect(r.until).toBeCloseTo(5.1);
});

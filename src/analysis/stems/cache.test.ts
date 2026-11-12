import { expect, test } from 'vitest';
import { MemoryStemStore, stemKey } from './cache';
import type { Stems } from './types';

const bytes = (...v: number[]) => new Uint8Array(v).buffer;

function fakeStems(n = 4): Stems {
  const mk = (k: number) => Float32Array.from({ length: n }, (_, i) => i * k);
  return { sampleRate: 44100, drums: mk(1), bass: mk(2), other: mk(3), vocals: mk(4) };
}

test('stemKey is stable and changes with content', async () => {
  const a = await stemKey(bytes(1, 2, 3));
  expect(a).toMatch(/^v1-[0-9a-f]{64}$/);
  expect(await stemKey(bytes(1, 2, 3))).toBe(a);
  expect(await stemKey(bytes(1, 2, 4))).not.toBe(a);
});

test('MemoryStemStore round-trips and misses unknown keys', async () => {
  const store = new MemoryStemStore();
  expect(await store.get('v1-nope')).toBeUndefined();
  const s = fakeStems();
  await store.put('k', s);
  const back = await store.get('k');
  expect(back).toBeDefined();
  expect(Array.from(back?.bass ?? [])).toEqual([0, 2, 4, 6]);
  expect(back?.sampleRate).toBe(44100);
});

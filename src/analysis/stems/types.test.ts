import { expect, test } from 'vitest';
import { assertStems, mixStems, type Stems } from './types';

/** 沒給的軌補零、長度取第一個給的 */
function stems(given: Partial<Record<keyof Omit<Stems, 'sampleRate'>, number[]>>): Stems {
  const len = Object.values(given)[0]?.length ?? 0;
  const pick = (k: keyof Omit<Stems, 'sampleRate'>) =>
    given[k] ? Float32Array.from(given[k] as number[]) : new Float32Array(len);
  return {
    sampleRate: 44100,
    drums: pick('drums'),
    bass: pick('bass'),
    other: pick('other'),
    vocals: pick('vocals'),
  };
}

test('mixStems adds sample-wise', () => {
  const s = stems({ bass: [1, 2], other: [10, 20] });
  expect(Array.from(mixStems(s, ['bass', 'other']))).toEqual([11, 22]);
});

test('assertStems rejects mismatched lengths', () => {
  const s = stems({ bass: [1, 2, 3] });
  s.other = new Float32Array(2);
  expect(() => assertStems(s)).toThrow(/length/);
});

test('assertStems accepts a consistent set', () => {
  expect(() => assertStems(stems({ bass: [1, 2] }))).not.toThrow();
});

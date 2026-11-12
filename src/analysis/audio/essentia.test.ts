import { expect, test } from 'vitest';
import { getEssentia } from './essentia';

test('getEssentia returns one shared instance with a version string', async () => {
  const a = await getEssentia();
  const b = await getEssentia();
  expect(a).toBe(b);
  expect(typeof a.version).toBe('string');
  const v = a.arrayToVector(new Float32Array([1, 2, 3]));
  expect(Array.from(a.vectorToArray(v))).toEqual([1, 2, 3]);
});

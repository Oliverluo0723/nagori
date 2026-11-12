import { expect, test } from 'vitest';
import { mulberry32 } from './prng';

test('mulberry32 is deterministic', () => {
  const a = mulberry32(7);
  const b = mulberry32(7);
  expect([a(), a(), a()]).toEqual([b(), b(), b()]);
});

test('mulberry32 yields values in [0, 1)', () => {
  const r = mulberry32(123);
  for (let i = 0; i < 100; i++) {
    const v = r();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  }
});

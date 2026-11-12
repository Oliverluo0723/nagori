import { expect, test } from 'vitest';
import { fft } from './fft';

test('an impulse has flat unit magnitude across all bins', () => {
  const re = new Float64Array(8);
  const im = new Float64Array(8);
  re[0] = 1;
  fft(re, im);
  for (let i = 0; i < 8; i++) expect(Math.hypot(re[i], im[i])).toBeCloseTo(1, 9);
});

test('a cosine at 4 cycles over 64 samples lands in bin 4 with magnitude N/2', () => {
  const n = 64;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 4 * i) / n);
  fft(re, im);
  expect(Math.hypot(re[4], im[4])).toBeCloseTo(n / 2, 6);
  for (let i = 0; i < n / 2; i++) {
    if (i !== 4) expect(Math.hypot(re[i], im[i])).toBeLessThan(1e-9);
  }
});

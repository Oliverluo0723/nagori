import { expect, test } from 'vitest';
import { frameLayout } from './frame';

test('plot box keeps the 48 px margin of a 1080 Oto poster and scales with the short side', () => {
  const big = frameLayout(1080, 1920, true);
  expect(big.plot.x).toBe(48);
  expect(big.plot.w).toBe(1080 - 96);
  const half = frameLayout(540, 960, true);
  expect(half.plot.x).toBe(24);
  expect(half.unit).toBeCloseTo(0.5);
});

test('a title pushes the plot down; the readout row sits below the plot', () => {
  const titled = frameLayout(1080, 1080, true);
  const plain = frameLayout(1080, 1080, false);
  expect(titled.plot.y).toBeGreaterThan(plain.plot.y);
  expect(titled.titleY).not.toBeNull();
  expect(plain.titleY).toBeNull();
  expect(titled.readoutY).toBeGreaterThan(titled.plot.y + titled.plot.h);
  expect(titled.plot.y + titled.plot.h).toBeLessThanOrEqual(1080);
});

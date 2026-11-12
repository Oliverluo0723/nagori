import { expect, test } from 'vitest';
import { RecordingPainter } from '../looks/painter/recording';
import { drawFrame, frameLayout, placeReadouts } from './frame';
import { darkGlow } from './themes';

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
  expect(titled.readoutY).not.toBeNull();
  expect(titled.readoutY as number).toBeGreaterThan(titled.plot.y + titled.plot.h);
  expect(titled.plot.y + titled.plot.h).toBeLessThanOrEqual(1080);
});

test('text never shrinks below the readable minimum (22 / 16 / 26 px at 1080-wide output)', () => {
  for (const [w, h] of [
    [540, 640],
    [360, 480],
    [1080, 1920],
  ]) {
    const L = frameLayout(w, h, false);
    expect(L.text.label).toBeGreaterThanOrEqual(22);
    expect(L.text.readLabel).toBeGreaterThanOrEqual(16);
    expect(L.text.readValue).toBeGreaterThanOrEqual(26);
  }
  // 大格子照比例放大，不被下限卡住
  expect(frameLayout(2160, 3840, false).text.label).toBeCloseTo(34);
});

test('pxPerRef scales the minimums for a smaller canvas (540-wide preview = 0.5)', () => {
  const out = frameLayout(540, 640, false, 1);
  const preview = frameLayout(270, 320, false, 0.5);
  expect(preview.text.label).toBeCloseTo(out.text.label / 2);
  expect(preview.text.readLabel).toBeCloseTo(out.text.readLabel / 2);
  expect(preview.text.readValue).toBeCloseTo(out.text.readValue / 2);
  // 整個版面跟輸出成比例（差在四捨五入）
  expect(Math.abs(preview.plot.y - out.plot.y / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(preview.plot.h - out.plot.h / 2)).toBeLessThanOrEqual(1);
  expect(preview.readoutY as number).toBeCloseTo((out.readoutY as number) / 2, 0);
});

test('small cells keep the plot box at least half the cell and inside it', () => {
  for (const [w, h] of [
    [540, 640],
    [360, 480],
    [360, 240],
    [200, 120],
  ]) {
    const L = frameLayout(w, h, false);
    expect(L.plot.h).toBeGreaterThanOrEqual(h * 0.5 - 1);
    expect(L.plot.y + L.plot.h).toBeLessThanOrEqual(h);
    expect(L.plot.x + L.plot.w).toBeLessThanOrEqual(w);
  }
});

test('a cell too short for the readout row hides it and gives the space to the plot', () => {
  expect(frameLayout(540, 640, false).readoutY).not.toBeNull();
  expect(frameLayout(360, 480, false).readoutY).not.toBeNull();
  const short = frameLayout(540, 200, false);
  expect(short.readoutY).toBeNull();
  const p = new RecordingPainter();
  drawFrame(p, {
    w: 540,
    h: 200,
    theme: darkGlow,
    layout: short,
    number: 3,
    name: 'glide',
    readouts: [{ label: 'NOTE', value: 'D1' }],
  });
  const texts = p.ops.filter((o) => o.op === 'text').map((o) => o.args[0]);
  expect(texts).toEqual(['03', 'GLIDE']);
});

test('readout columns that do not fit the cell width are dropped from the end', () => {
  const readouts = [
    { label: 'NOTE', value: 'D1' },
    { label: 'FREQUENCY', value: '36.7 Hz' },
    { label: 'RANGE', value: 'A0 – A2' },
    { label: 'WINDOW', value: '2 bars' },
  ];
  const wide = frameLayout(1080, 1920, false);
  expect(placeReadouts(readouts, wide, 1080)).toHaveLength(4);
  const narrow = frameLayout(360, 480, false);
  const placed = placeReadouts(readouts, narrow, 360);
  expect(placed.length).toBeGreaterThan(0);
  expect(placed.length).toBeLessThan(4);
  expect(placed.map((r) => r.label)).toEqual(readouts.slice(0, placed.length).map((r) => r.label));
  // 放得下的每一欄都在右邊距內
  const last = placed[placed.length - 1];
  expect(last.x + last.value.length * 0.6 * narrow.text.readValue).toBeLessThanOrEqual(
    360 - narrow.margin,
  );
});

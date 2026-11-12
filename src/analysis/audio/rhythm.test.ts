import { expect, test } from 'vitest';
import { synthBeat } from '../../../test/fixtures/audio';
import { analyzeRhythm, bpmCandidates, firstBeatOffset } from './rhythm';

const nearestHalf = (t: number) => Math.abs(t - Math.round(t * 2) / 2);

test('120 bpm synthetic beat: bpm, beats on the half-second grid, small offset', async () => {
  const r = await analyzeRhythm(synthBeat({ bars: 8 }));
  expect(r.bpm).toBeGreaterThan(119);
  expect(r.bpm).toBeLessThan(121);
  expect(r.beats.length).toBeGreaterThan(20);
  for (const b of r.beats) expect(nearestHalf(b)).toBeLessThanOrEqual(0.06);
  expect(Math.abs(r.offset)).toBeLessThanOrEqual(0.06);
  expect(r.confidence).toBeGreaterThan(0);
}, 30000);

test('candidates contain the ×4/3 and ×3/4 ambiguities and stay inside 60–200', async () => {
  const c = bpmCandidates(120);
  expect(c[0]).toBe(120);
  expect(c).toContain(160);
  expect(c).toContain(90);
  expect(c.some((x) => x > 200 || x < 60)).toBe(false);
  expect(bpmCandidates(95.8)).toContain(127.7);
  expect(new Set(c).size).toBe(c.length);
});

test('a 1.3 s lead-in gives an offset equal to the lead-in modulo one beat (review focus 1)', async () => {
  const r = await analyzeRhythm(synthBeat({ bars: 8, leadIn: 1.3 }));
  expect(Math.abs(r.offset - 0.3)).toBeLessThanOrEqual(0.06);
  expect(r.offset).toBeGreaterThanOrEqual(0);
  expect(r.offset).toBeLessThan(0.5);
}, 30000);

test('firstBeatOffset folds the first tick back into [0, beat)', () => {
  expect(firstBeatOffset([1.3, 1.8, 2.3], 120)).toBeCloseTo(0.3, 6);
  expect(firstBeatOffset([0.02, 0.52], 120)).toBeCloseTo(0.02, 6);
  expect(firstBeatOffset([], 120)).toBe(0);
  // 幾乎對齊但略早：折成小負數，而不是 0.49
  expect(firstBeatOffset([0.49, 0.99, 1.49], 120)).toBeCloseTo(-0.01, 6);
  // 靜音前奏裡的兩個亂 tick 不該影響多數決
  expect(
    Math.abs(firstBeatOffset([0.441, 0.882, 1.324, 1.823, 2.322, 2.821, 3.32], 120) - 0.32),
  ).toBeLessThan(0.03);
});

test('silence or a too-short file gives bpm 0 and no beats (review focus 3)', async () => {
  const silent = await analyzeRhythm(new Float32Array(44100));
  expect(silent).toMatchObject({ bpm: 0, beats: [], candidates: [], offset: 0 });
}, 30000);

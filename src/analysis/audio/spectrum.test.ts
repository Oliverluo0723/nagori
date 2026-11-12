import { expect, test } from 'vitest';
import { analyzeSpectrum, bandEnergy, binHz, binValue, frameAt, peakHold } from './spectrum';

const SR = 44100;

function sine(hz: number, seconds: number, amp = 0.5): Float32Array {
  const pcm = new Float32Array(Math.round(SR * seconds));
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin((2 * Math.PI * hz * i) / SR) * amp;
  return pcm;
}

test('a 440 Hz sine lands in the bin that contains 440 Hz', () => {
  const s = analyzeSpectrum(sine(440, 2), SR);
  expect(s.fps).toBe(50);
  expect(s.bins).toBe(64);
  expect(s.frameCount).toBe(100);
  const f = frameAt(s, 1);
  let best = 0;
  for (let b = 0; b < 64; b++) if (binValue(s, f, b) > binValue(s, f, best)) best = b;
  expect(binHz(s, best)).toBeGreaterThan(380);
  expect(binHz(s, best)).toBeLessThan(510);
  expect(bandEnergy(s, f, 5000, 16000)).toBeLessThan(0.15);
});

test('frameAt clamps past the end and before 0', () => {
  const s = analyzeSpectrum(sine(440, 1), SR);
  expect(frameAt(s, -1)).toBe(0);
  expect(frameAt(s, 999)).toBe(s.frameCount - 1);
});

test('peakHold is the max over the hold window', () => {
  // 前 1 秒靜音、後 1 秒 440 Hz
  const pcm = new Float32Array(SR * 2);
  pcm.set(sine(440, 1), SR);
  const s = analyzeSpectrum(pcm, SR);
  const f = frameAt(s, 1.5);
  let bin = 0;
  for (let b = 0; b < 64; b++) if (binValue(s, f, b) > binValue(s, f, bin)) bin = b;
  let expected = 0;
  for (let k = f - 50; k <= f; k++) expected = Math.max(expected, binValue(s, k, bin));
  expect(peakHold(s, f, bin, 50)).toBeCloseTo(expected, 9);
  // 視窗跨過靜音段：hold 仍回傳有聲段的最大值，而靜音幀本身接近 0
  expect(binValue(s, frameAt(s, 0.5), bin)).toBeLessThan(0.05);
  expect(peakHold(s, frameAt(s, 1.02), bin, 50)).toBeGreaterThan(0.3);
});

test('60 s of audio analyses in under 2 s', () => {
  const pcm = sine(220, 60);
  const t0 = performance.now();
  const s = analyzeSpectrum(pcm, SR);
  const ms = performance.now() - t0;
  expect(s.frameCount).toBe(3000);
  expect(ms).toBeLessThan(2000);
});

import { expect, test } from 'vitest';
import { expectedHits, synthBeat } from '../../../test/fixtures/audio';
import type { DrumHit, DrumKind } from '../types';
import { detectDrums } from './drums';
import { analyzeSpectrum } from './spectrum';

const SR = 44100;
const TOL = 0.04;

function score(found: DrumHit[], truth: DrumHit[], kind: DrumKind) {
  const f = found.filter((h) => h.kind === kind);
  const t = truth.filter((h) => h.kind === kind);
  const matched = new Set<number>();
  let hits = 0;
  for (const x of f) {
    const i = t.findIndex((y, j) => !matched.has(j) && Math.abs(y.time - x.time) <= TOL);
    if (i >= 0) {
      matched.add(i);
      hits++;
    }
  }
  return { precision: f.length ? hits / f.length : 0, recall: t.length ? hits / t.length : 0 };
}

test('synthetic beat: each drum kind detected with precision and recall ≥ 0.85', async () => {
  const pcm = synthBeat({ bars: 8 });
  const found = await detectDrums(pcm, analyzeSpectrum(pcm, SR));
  const truth = expectedHits({ bars: 8 });
  for (const kind of ['kick', 'snare', 'hat'] as const) {
    const { precision, recall } = score(found, truth, kind);
    expect(precision, `${kind} precision`).toBeGreaterThanOrEqual(0.85);
    expect(recall, `${kind} recall`).toBeGreaterThanOrEqual(0.85);
  }
  for (const h of found) {
    expect(h.velocity).toBeGreaterThanOrEqual(0.3);
    expect(h.velocity).toBeLessThanOrEqual(1);
  }
  expect(found.map((h) => h.time)).toEqual([...found.map((h) => h.time)].sort((a, b) => a - b));
}, 60000);

test('silence and a steady sine give no hits (review focus 3)', async () => {
  const silent = new Float32Array(SR * 4);
  expect(await detectDrums(silent, analyzeSpectrum(silent, SR))).toEqual([]);
  // 1 秒淡入的正弦：沒有任何瞬態（突然開始的正弦本身就是一個 onset，不算在這裡）
  const sine = new Float32Array(SR * 4);
  for (let i = 0; i < sine.length; i++) {
    const fade = Math.min(1, i / SR);
    sine[i] = Math.sin((2 * Math.PI * 220 * i) / SR) * 0.5 * fade;
  }
  expect(await detectDrums(sine, analyzeSpectrum(sine, SR))).toEqual([]);
}, 60000);

import { expect, test } from 'vitest';
import { expectedHits, synthBeat } from './audio';

test('synthBeat length is bars × 2 s plus a 1 s tail at 44.1 kHz', () => {
  const pcm = synthBeat({ bars: 1 });
  expect(pcm.length).toBe(44100 * 3);
  expect(Math.max(...Array.from(pcm.subarray(0, 4410)))).toBeGreaterThan(0.1);
});

test('expectedHits for 2 bars: kicks on 1 and 3 (plus the odd-bar pickup), snares on 2 and 4, hats every 8th', () => {
  const hits = expectedHits({ bars: 2 });
  const of = (kind: string) => hits.filter((h) => h.kind === kind).map((h) => h.time);
  expect(of('kick')).toEqual([0, 1, 2, 3, 3.75]);
  expect(of('snare')).toEqual([0.5, 1.5, 2.5, 3.5]);
  expect(of('hat')).toHaveLength(16);
  expect(of('hat')[1]).toBeCloseTo(0.25);
});

test('leadIn shifts every hit and pads silence in front', () => {
  const hits = expectedHits({ bars: 1, leadIn: 1.3 });
  expect(hits[0].time).toBeCloseTo(1.3);
  const pcm = synthBeat({ bars: 1, leadIn: 1.3 });
  expect(Math.max(...Array.from(pcm.subarray(0, 44100)))).toBe(0);
});

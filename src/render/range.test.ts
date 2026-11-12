import { describe, expect, it } from 'vitest';
import { tempoMapFromBpm } from '../analysis/tempo';
import { exportRange, frameCount, frameTime, nearestBarStart } from './range';

// 120 BPM、第一拍 0.5 s：一小節 2 s，小節頭在 0.5、2.5、4.5…
const tempo = tempoMapFromBpm(120, 0.5);

describe('nearestBarStart', () => {
  it('snaps to the closer bar start', () => {
    expect(nearestBarStart(tempo, 2.9)).toBeCloseTo(2.5);
    expect(nearestBarStart(tempo, 4.0)).toBeCloseTo(4.5);
  });

  it('clamps bars before the first beat to 0', () => {
    expect(nearestBarStart(tempo, 0.1)).toBeGreaterThanOrEqual(0);
  });
});

describe('exportRange', () => {
  const base = { tempo, duration: 100, snap: true } as const;

  it('full is 0 to the end regardless of the playhead', () => {
    expect(exportRange({ ...base, length: 'full', playhead: 42 })).toEqual({ start: 0, end: 100 });
  });

  it('starts at the snapped playhead', () => {
    const r = exportRange({ ...base, length: 15, playhead: 10.7 });
    expect(r.start).toBeCloseTo(10.5);
    expect(r.end).toBeCloseTo(25.5);
  });

  it('keeps the raw playhead when snapping is off', () => {
    expect(exportRange({ ...base, snap: false, length: 30, playhead: 10.7 })).toEqual({
      start: 10.7,
      end: 40.7,
    });
  });

  it('moves the clip earlier rather than cutting it short near the end', () => {
    expect(exportRange({ ...base, length: 30, playhead: 90 })).toEqual({ start: 70, end: 100 });
  });

  it('a song shorter than the length exports whole', () => {
    expect(exportRange({ ...base, duration: 12, length: 15, playhead: 3 })).toEqual({
      start: 0,
      end: 12,
    });
  });
});

describe('frames', () => {
  it('counts and times frames from the range start', () => {
    const r = { start: 10, end: 25 };
    expect(frameCount(r, 30)).toBe(450);
    expect(frameTime(r, 30, 0)).toBe(10);
    expect(frameTime(r, 30, 30)).toBeCloseTo(11);
  });
});

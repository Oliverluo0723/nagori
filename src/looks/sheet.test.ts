import { expect, test } from 'vitest';
import { bandEnergy } from '../analysis/audio/spectrum';
import { tempoMapFromBpm } from '../analysis/tempo';
import type { Spectrum } from '../analysis/types';
import { bandSeries, energySeries, formatTime, paramNum, printedBeat } from './sheet';
import type { LookContext, ParamDef } from './types';

function spectrum(frames: number[][], bins = 4): Spectrum {
  const data = new Float32Array(frames.length * bins);
  frames.forEach((row, f) => {
    row.forEach((v, b) => {
      data[f * bins + b] = v;
    });
  });
  return { fps: 50, bins, minHz: 30, maxHz: 16000, frames: data, frameCount: frames.length };
}

test('energySeries is the per-frame mean and is cached per spectrum', () => {
  const s = spectrum([
    [0, 0, 0, 0],
    [1, 0.5, 0.5, 0],
    [1, 1, 1, 1],
  ]);
  const e = energySeries(s);
  expect(Array.from(e)).toEqual([0, 0.5, 1]);
  expect(energySeries(s)).toBe(e);
  expect(energySeries(spectrum([[1, 1, 1, 1]]))).not.toBe(e);
});

test('bandSeries matches bandEnergy frame by frame and is cached per band', () => {
  const s = spectrum([
    [1, 0, 0, 0],
    [0, 0, 0, 1],
  ]);
  const low = bandSeries(s, 30, 100);
  expect(low[0]).toBeCloseTo(bandEnergy(s, 0, 30, 100));
  expect(low[1]).toBeCloseTo(bandEnergy(s, 1, 30, 100));
  expect(bandSeries(s, 30, 100)).toBe(low);
  expect(bandSeries(s, 4000, 16000)).not.toBe(low);
});

test('formatTime renders m:ss', () => {
  expect(formatTime(0)).toBe('0:00');
  expect(formatTime(65)).toBe('1:05');
  expect(formatTime(599.6)).toBe('9:59');
});

test('paramNum falls back to the definition default', () => {
  const defs: ParamDef[] = [{ key: 'rows', label: 'rows', min: 1, max: 9, default: 4 }];
  const ctx = { params: {} } as unknown as LookContext;
  expect(paramNum(ctx, defs, 'rows')).toBe(4);
  expect(paramNum({ params: { rows: 7 } } as unknown as LookContext, defs, 'rows')).toBe(7);
  expect(paramNum(ctx, defs, 'missing')).toBe(0);
});

test('printedBeat gives the seconds of the beat ending at t', () => {
  const tempo = tempoMapFromBpm(120);
  expect(printedBeat(tempo, 10)).toBeCloseTo(0.5);
  expect(printedBeat(tempoMapFromBpm(60), 3)).toBeCloseTo(1);
});

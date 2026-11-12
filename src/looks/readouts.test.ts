import { expect, test } from 'vitest';
import { flatSpectrum, makeCtx } from '../../test/fixtures/looks';
import { readoutsFor } from './readouts';
import { looks } from './registry';

test('sheet looks read PRINTED / PEN / TIME', () => {
  const r = readoutsFor(
    looks.ridge,
    makeCtx(30, { duration: 60, spectrum: flatSpectrum(60, 0.5) }),
  );
  expect(r).toEqual([
    { label: 'PRINTED', value: '50 %' },
    { label: 'PEN', value: 'Ridge' },
    { label: 'TIME', value: '0:30' },
  ]);
});

test('drum looks count the hits so far, then bar and tempo; at most four columns', () => {
  const drums = [0.5, 1, 1.5, 9].map((time) => ({ time, kind: 'kick' as const, velocity: 1 }));
  const r = readoutsFor(looks.rings, makeCtx(2.1, { drums }));
  expect(r[0]).toEqual({ label: 'HITS', value: '3' });
  expect(r.find((c) => c.label === 'TEMPO')?.value).toBe('120 BPM');
  expect(r.find((c) => c.label === 'BAR')?.value).toBe('2.1');
  expect(r.length).toBeLessThanOrEqual(4);
});

test('bass looks name the note sounding now', () => {
  const bass = [{ time: 0, duration: 4, midi: 26, bends: [] }];
  const r = readoutsFor(looks.glide, makeCtx(1, { bass }));
  expect(r[0]).toEqual({ label: 'BASS', value: 'D1' });
});

test('a look can supply its own readouts', () => {
  const custom = { ...looks.rings, readouts: () => [{ label: 'X', value: '1' }] };
  expect(readoutsFor(custom, makeCtx(0, {}))).toEqual([{ label: 'X', value: '1' }]);
});

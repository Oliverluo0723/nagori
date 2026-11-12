import { expect, test } from 'vitest';
import { flatSpectrum, hasText, makeCtx, opsOf, spectrumWith } from '../../test/fixtures/looks';
import type { BassNote } from '../analysis/types';
import { paperInk } from '../compose/themes';
import { RecordingPainter } from './painter/recording';
import { readoutsFor } from './readouts';
import { looks } from './registry';
import { brightAt, trajectoryLook } from './trajectory';

const note = (time: number, midi: number): BassNote => ({ time, duration: 0.9, midi, bends: [] });
const bass = Array.from({ length: 30 }, (_, i) => note(i, i < 15 ? 36 : 48));

test('registry exposes trajectory as number 28', () => {
  expect(looks.trajectory).toBe(trajectoryLook);
  expect(trajectoryLook).toMatchObject({ id: 'trajectory', number: 28, name: '軌跡' });
});

test('deterministic; one glowing path on dark, none on paper', () => {
  const s = flatSpectrum(60, 0.4);
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  trajectoryLook.draw(a, makeCtx(12, { spectrum: s, bass }));
  trajectoryLook.draw(b, makeCtx(12, { spectrum: s, bass }));
  expect(a.ops).toEqual(b.ops);
  expect(opsOf(a, 'glow')).toHaveLength(1);
  const paper = new RecordingPainter();
  trajectoryLook.draw(paper, makeCtx(12, { spectrum: s, bass }, { theme: paperInk }));
  expect(opsOf(paper, 'glow')).toHaveLength(0);
  for (const label of ['BASS NOTE', 'BRIGHTNESS', 'TIME']) expect(hasText(a, label)).toBe(true);
});

test('the current point sits higher on a higher bass note', () => {
  const ringY = (t: number) => {
    const p = new RecordingPainter();
    trajectoryLook.draw(p, makeCtx(t, { bass }, { w: 1080, h: 1080 }));
    const ring = opsOf(p, 'circle').find(
      (o) => Math.abs((o.args[2] as number) - 1080 * 0.04) < 1e-6,
    );
    return ring?.args[1] as number;
  };
  expect(ringY(20.5)).toBeLessThan(ringY(10.5));
});

test('brightness follows where the energy sits in the spectrum', () => {
  // 前 30 秒能量在低頻、後 30 秒在高頻
  const s = spectrumWith(60, (b, f) => (f < 300 ? (b < 4 ? 0.9 : 0.05) : b > 11 ? 0.9 : 0.05));
  expect(brightAt(s, 50)).toBeGreaterThan(brightAt(s, 10));
  expect(brightAt(undefined, 10)).toBe(0.5);
});

test('readouts: WINDOW, BASS, BRIGHT, POINTS in the window', () => {
  const r = readoutsFor(trajectoryLook, makeCtx(10.5, { bass, spectrum: flatSpectrum(60, 0.4) }));
  expect(r.map((x) => x.label)).toEqual(['WINDOW', 'BASS', 'BRIGHT', 'POINTS']);
  expect(r[0].value).toBe('9 s');
  expect(r[1].value).toBe('C2');
  expect(Number(r[2].value)).toBeGreaterThanOrEqual(0);
  // (1.5, 10.5] 內的起點：2..10
  expect(r[3].value).toBe('9');
});

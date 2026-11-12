import { expect, test } from 'vitest';
import { flatSpectrum, hasText, makeCtx, opsOf } from '../../test/fixtures/looks';
import { paperInk } from '../compose/themes';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';
import { BANDS7 } from './sheet';
import { spots, strataLook } from './strata';

test('deterministic for a seed; another seed moves the spots', () => {
  const s = flatSpectrum(60, 0.5);
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  const c = new RecordingPainter();
  strataLook.draw(a, makeCtx(10, { spectrum: s }));
  strataLook.draw(b, makeCtx(10, { spectrum: s }));
  strataLook.draw(c, makeCtx(10, { spectrum: s }, { seed: 9 }));
  expect(a.ops).toEqual(b.ops);
  expect(c.ops).not.toEqual(a.ops);
  const xs = spots(1, 1080, 1920).map((q) => q.x);
  for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
});

test('seven bodies with rings and names, joined by one path', () => {
  const p = new RecordingPainter();
  strataLook.draw(p, makeCtx(10, { spectrum: flatSpectrum(60, 0.5) }, { label: '16 STRATA' }));
  expect(opsOf(p, 'ellipse')).toHaveLength(BANDS7.length * 2);
  expect(opsOf(p, 'polyline')).toHaveLength(1);
  for (const b of BANDS7) expect(hasText(p, b.name)).toBe(true);
  expect(hasText(p, '16 STRATA')).toBe(true);
});

test('louder band is a bigger body; no spectrum still draws the bodies small', () => {
  const size = (v: number) => {
    const p = new RecordingPainter();
    strataLook.draw(p, makeCtx(10, { spectrum: flatSpectrum(60, v) }));
    return opsOf(p, 'ellipse')[1].args[2] as number;
  };
  expect(size(0.9)).toBeGreaterThan(size(0.1));
  const none = new RecordingPainter();
  strataLook.draw(none, makeCtx(10, {}, { theme: paperInk }));
  expect(opsOf(none, 'ellipse')).toHaveLength(BANDS7.length * 2);
  expect(opsOf(none, 'glow')).toHaveLength(0);
});

test('a recent kick bursts rays at the sub body; an old one does not', () => {
  const kick = { time: 10, kind: 'kick' as const, velocity: 1 };
  const fresh = new RecordingPainter();
  strataLook.draw(fresh, makeCtx(10.1, { drums: [kick] }));
  expect(opsOf(fresh, 'line')).toHaveLength(24);
  const old = new RecordingPainter();
  strataLook.draw(old, makeCtx(12, { drums: [kick] }));
  expect(opsOf(old, 'line')).toHaveLength(0);
});

test('registry exposes strata as number 16', () => {
  expect(looks.strata).toBe(strataLook);
  expect(strataLook).toMatchObject({ id: 'strata', number: 16 });
});

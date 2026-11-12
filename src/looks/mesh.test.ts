import { expect, test } from 'vitest';
import { flatSpectrum, hasText, makeCtx, opsOf, spectrumWith } from '../../test/fixtures/looks';
import { binHz } from '../analysis/audio/spectrum';
import { darkGlow } from '../compose/themes';
import { BANDS, meshLook } from './mesh';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';

type Pt = { x: number; y: number };
const W = 1080;
const H = 1920;

/** 只有 lo..hi 這段頻率有聲音的頻譜。 */
const bandOnly = ([lo, hi]: [number, number]) => {
  const base = spectrumWith(60, () => 0, { bins: 32 });
  return spectrumWith(60, (b) => (binHz(base, b) >= lo && binHz(base, b) < hi ? 1 : 0.05), {
    bins: 32,
  });
};

test('deterministic', () => {
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  meshLook.draw(a, makeCtx(20, { spectrum: flatSpectrum(60, 0.5) }));
  meshLook.draw(b, makeCtx(20, { spectrum: flatSpectrum(60, 0.5) }));
  expect(a.ops).toEqual(b.ops);
});

test('without spectrum: label only, no ribbons', () => {
  const p = new RecordingPainter();
  meshLook.draw(p, makeCtx(10, {}, { label: '10 MESH' }));
  expect(hasText(p, '10 MESH')).toBe(true);
  expect(opsOf(p, 'polyline')).toHaveLength(0);
});

test('ribbons span the whole width when fully printed and fill the height', () => {
  const p = new RecordingPainter();
  meshLook.draw(p, makeCtx(60, { spectrum: bandOnly(BANDS[3]) }));
  const pts = opsOf(p, 'polyline').flatMap((o) => o.args[0] as Pt[]);
  expect(Math.min(...pts.map((pt) => pt.x))).toBeCloseTo(0);
  expect(Math.max(...pts.map((pt) => pt.x))).toBeCloseTo(W);
  expect(Math.max(...pts.map((pt) => pt.y))).toBeGreaterThan(H * 0.85);
  expect(Math.min(...pts.map((pt) => pt.y))).toBeLessThan(H * 0.15);
});

test('the band with energy opens into a thick ribbon; quiet bands stay thin', () => {
  const p = new RecordingPainter();
  meshLook.draw(p, makeCtx(60, { spectrum: bandOnly(BANDS[3]) }));
  const pts = opsOf(p, 'polyline').flatMap((o) => o.args[0] as Pt[]);
  const pitch = H / BANDS.length;
  const height = (lane: number) => {
    const ys = pts
      .filter((pt) => pt.x > W * 0.3 && pt.x < W * 0.7)
      .map((pt) => pt.y)
      .filter((y) => y > lane * pitch + pitch * 0.05 && y < (lane + 1) * pitch - pitch * 0.05);
    return ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  };
  expect(height(3)).toBeGreaterThan(height(0) * 3);
});

test('weaving stops at t, with the newest stretch in accent and a pen', () => {
  const p = new RecordingPainter();
  meshLook.draw(p, makeCtx(15, { spectrum: flatSpectrum(60, 0.5) }));
  const pts = opsOf(p, 'polyline').flatMap((o) => o.args[0] as Pt[]);
  expect(Math.max(...pts.map((pt) => pt.x))).toBeLessThan(W * 0.3);
  expect(opsOf(p, 'stroke').map((o) => o.args[0])).toContain(darkGlow.accent);
  expect(opsOf(p, 'circle')).toHaveLength(2);
});

test('registry exposes mesh as number 10', () => {
  expect(looks.mesh).toBe(meshLook);
  expect(meshLook).toMatchObject({ id: 'mesh', number: 10 });
});

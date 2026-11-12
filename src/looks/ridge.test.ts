import { expect, test } from 'vitest';
import { tempoMapFromBpm } from '../analysis/tempo';
import type { Readings, Spectrum } from '../analysis/types';
import { darkGlow, paperInk } from '../compose/themes';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';
import { ridgeLook } from './ridge';
import type { LookContext } from './types';

const BINS = 8;
const tempo = tempoMapFromBpm(120);

/** 每秒 fps 幀、全部同一列值的頻譜。 */
function flatSpectrum(seconds: number, value: number, fps = 10): Spectrum {
  const frameCount = seconds * fps;
  const frames = new Float32Array(frameCount * BINS).fill(value);
  return { fps, bins: BINS, minHz: 30, maxHz: 16000, frames, frameCount };
}

const ctx = (
  t: number,
  s?: Spectrum,
  params: Record<string, number> = {},
  theme = darkGlow,
): LookContext => ({
  t,
  w: 1080,
  h: 1920,
  readings: { duration: 60, tempo, drums: [], roles: [], spectrum: s } as Readings,
  theme,
  params,
  seed: 1,
  label: '07 RIDGE',
});

const polylines = (p: RecordingPainter) => p.ops.filter((o) => o.op === 'polyline');
const strokeBefore = (p: RecordingPainter, index: number) => {
  let color: unknown;
  for (let i = 0; i < index; i++) if (p.ops[i].op === 'stroke') color = p.ops[i].args[0];
  return color;
};

test('deterministic', () => {
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  ridgeLook.draw(a, ctx(12, flatSpectrum(60, 0.5)));
  ridgeLook.draw(b, ctx(12, flatSpectrum(60, 0.5)));
  expect(a.ops).toEqual(b.ops);
});

test('without spectrum: background, label and Hz ticks, no ridge lines', () => {
  const p = new RecordingPainter();
  ridgeLook.draw(p, ctx(5, undefined, {}, paperInk));
  expect(p.ops[0]).toEqual({ op: 'background', args: [paperInk.paper] });
  expect(p.ops.some((o) => o.op === 'text' && o.args[0] === '07 RIDGE')).toBe(true);
  expect(p.ops.some((o) => o.op === 'text' && o.args[0] === '1k')).toBe(true);
  expect(polylines(p)).toHaveLength(0);
  expect(p.ops.some((o) => o.op === 'glow')).toBe(false);
});

test('rows printed up to t: finished rows in ink, current row in accent, later rows absent', () => {
  const p = new RecordingPainter();
  // 60 秒切 6 列，每列 10 秒；t = 15 在第 2 列中間
  ridgeLook.draw(p, ctx(15, flatSpectrum(60, 0.5), { rows: 6 }));
  const lines = polylines(p);
  expect(lines).toHaveLength(2);
  const idx = lines.map((l) => p.ops.indexOf(l));
  expect(strokeBefore(p, idx[0])).toBe(darkGlow.ink);
  expect(strokeBefore(p, idx[1])).toBe(darkGlow.accent);
  // 每列的點數 = bins，x 由左到右遞增
  const pts = lines[0].args[0] as { x: number; y: number }[];
  expect(pts).toHaveLength(BINS);
  for (let i = 1; i < pts.length; i++) expect(pts[i].x).toBeGreaterThan(pts[i - 1].x);
  // 時間標籤：第 1 列 0:00、第 2 列 0:10
  expect(p.ops.some((o) => o.op === 'text' && o.args[0] === '0:00')).toBe(true);
  expect(p.ops.some((o) => o.op === 'text' && o.args[0] === '0:10')).toBe(true);
});

test('louder rows rise higher; silence sits on the baseline', () => {
  const quiet = new RecordingPainter();
  const loud = new RecordingPainter();
  ridgeLook.draw(quiet, ctx(5, flatSpectrum(60, 0), { rows: 6 }));
  ridgeLook.draw(loud, ctx(5, flatSpectrum(60, 1), { rows: 6 }));
  const yq = (polylines(quiet)[0].args[0] as { y: number }[])[0].y;
  const yl = (polylines(loud)[0].args[0] as { y: number }[])[0].y;
  expect(yl).toBeLessThan(yq);
});

test('registry exposes ridge as number 7', () => {
  expect(looks.ridge).toBe(ridgeLook);
  expect(ridgeLook).toMatchObject({ id: 'ridge', number: 7, listens: ['spectrum'] });
});

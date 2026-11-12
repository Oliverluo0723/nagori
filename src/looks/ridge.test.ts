import { expect, test } from 'vitest';
import { flatSpectrum, hasText, makeCtx, opsOf, spectrumWith } from '../../test/fixtures/looks';
import { darkGlow, paperInk } from '../compose/themes';
import type { PaintOp } from './painter/recording';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';
import { ridgeLook } from './ridge';

type Pt = { x: number; y: number };
const strokeBefore = (p: RecordingPainter, op: PaintOp) => {
  let color: unknown;
  for (const o of p.ops) {
    if (o === op) return color;
    if (o.op === 'stroke') color = o.args[0];
  }
  return color;
};
/** 前 30 秒全靜音、後 30 秒每個 bin 都滿。 */
const halfLoud = () => spectrumWith(60, (_b, f) => (f >= 300 ? 1 : 0), { fps: 10, bins: 16 });

test('deterministic', () => {
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  ridgeLook.draw(a, makeCtx(12, { spectrum: halfLoud() }));
  ridgeLook.draw(b, makeCtx(12, { spectrum: halfLoud() }));
  expect(a.ops).toEqual(b.ops);
});

test('without spectrum: Hz ticks and the whole sheet of faint baselines, no ridge lines', () => {
  const p = new RecordingPainter();
  ridgeLook.draw(p, makeCtx(5, {}, { theme: paperInk }));
  expect(p.ops[0]).toEqual({ op: 'background', args: [paperInk.paper] });
  expect(hasText(p, '1k')).toBe(true);
  expect(hasText(p, '0:00')).toBe(true);
  expect(opsOf(p, 'polyline')).toHaveLength(0);
  // 幾十列淡基線，一路鋪到格子底部
  const lines = opsOf(p, 'line');
  expect(lines.length).toBeGreaterThan(60);
  const ys = lines.map((l) => l.args[1] as number);
  expect(Math.max(...ys)).toBeGreaterThan(1920 * 0.9);
  expect(Math.min(...ys)).toBeLessThan(1920 * 0.15);
});

test('rows printed up to t: finished rows in ink, the current row in accent with the pen', () => {
  const p = new RecordingPainter();
  ridgeLook.draw(p, makeCtx(30, { spectrum: flatSpectrum(60, 0.5) }));
  const lines = opsOf(p, 'polyline');
  // 已印列數 + 未印基線（扣掉 Hz 軸那條）= 總列數；t = 30 是一半
  const rows = lines.length + opsOf(p, 'line').length - 1;
  expect(lines.length).toBeGreaterThan(rows * 0.45);
  expect(lines.length).toBeLessThan(rows * 0.55);
  expect(strokeBefore(p, lines[0])).toBe(darkGlow.ink);
  expect(strokeBefore(p, lines[lines.length - 1])).toBe(darkGlow.accent);
  // 每列 = 左端 + bins + 右端，x 由左到右遞增
  const pts = lines[0].args[0] as Pt[];
  expect(pts).toHaveLength(16 + 2);
  for (let i = 1; i < pts.length; i++) expect(pts[i].x).toBeGreaterThan(pts[i - 1].x);
  // 筆頭：環 + 中心點
  expect(opsOf(p, 'circle').length).toBeGreaterThanOrEqual(2);
});

test('silent rows sit on their baseline; loud rows rise above it', () => {
  const p = new RecordingPainter();
  ridgeLook.draw(p, makeCtx(59, { spectrum: halfLoud() }));
  const lines = opsOf(p, 'polyline').map((l) => l.args[0] as Pt[]);
  const silent = lines[0];
  for (const pt of silent) expect(pt.y).toBeCloseTo(silent[0].y);
  const loud = lines[lines.length - 2];
  expect(Math.min(...loud.map((pt) => pt.y))).toBeLessThan(loud[0].y - 10);
});

test('fills a square cell too', () => {
  const p = new RecordingPainter();
  ridgeLook.draw(p, makeCtx(59, { spectrum: halfLoud() }, { w: 900, h: 800 }));
  const pts = opsOf(p, 'polyline').flatMap((l) => l.args[0] as Pt[]);
  expect(Math.min(...pts.map((pt) => pt.y))).toBeGreaterThanOrEqual(0);
  expect(Math.max(...pts.map((pt) => pt.y))).toBeGreaterThan(800 * 0.85);
  expect(Math.max(...pts.map((pt) => pt.x))).toBeCloseTo(900);
});

test('registry exposes ridge as number 7', () => {
  expect(looks.ridge).toBe(ridgeLook);
  expect(ridgeLook).toMatchObject({ id: 'ridge', number: 7, listens: ['spectrum'] });
});

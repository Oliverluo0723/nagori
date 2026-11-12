import { expect, test } from 'vitest';
import { hasText, makeCtx, opsOf } from '../../test/fixtures/looks';
import type { DrumHit } from '../analysis/types';
import { darkGlow } from '../compose/themes';
import { drumLook } from './drum';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';

type Pt = { x: number; y: number };
const points = (p: RecordingPainter) => opsOf(p, 'polyline').flatMap((o) => o.args[0] as Pt[]);
const spread = (pts: Pt[]) =>
  Math.max(...pts.map((pt) => pt.y)) - Math.min(...pts.map((pt) => pt.y));

test('deterministic', () => {
  const hits: DrumHit[] = [{ time: 1, kind: 'kick', velocity: 1 }];
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  drumLook.draw(a, makeCtx(3, { drums: hits }));
  drumLook.draw(b, makeCtx(3, { drums: hits }));
  expect(a.ops).toEqual(b.ops);
});

test('rows fill the whole cell: a time label per row, faint baselines for rows not yet printed', () => {
  const p = new RecordingPainter();
  drumLook.draw(p, makeCtx(1, {}));
  expect(hasText(p, '0:00')).toBe(true);
  const labels = opsOf(p, 'text');
  expect(labels.length).toBeGreaterThan(12);
  const ys = opsOf(p, 'line').map((l) => l.args[1] as number);
  expect(Math.max(...ys)).toBeGreaterThan(1920 * 0.9);
});

test('a dense waveform: hits swing the line wide, silence stays a thin line', () => {
  const kicks: DrumHit[] = [];
  for (let s = 0; s < 4; s += 0.5) kicks.push({ time: s, kind: 'kick', velocity: 1 });
  const loud = new RecordingPainter();
  const quiet = new RecordingPainter();
  drumLook.draw(loud, makeCtx(2.5, { drums: kicks }));
  drumLook.draw(quiet, makeCtx(2.5, { drums: [] }));
  expect(spread(points(loud))).toBeGreaterThan(spread(points(quiet)) * 10);
  // 密：每列幾百個點
  expect(points(loud).length).toBeGreaterThan(200);
});

test('only up to t is printed; the last two beats are accent, with a pen and a head line', () => {
  const hits: DrumHit[] = [{ time: 2, kind: 'kick', velocity: 1 }];
  const p = new RecordingPainter();
  drumLook.draw(p, makeCtx(2.5, { drums: hits }));
  const lines = opsOf(p, 'polyline');
  expect(lines.length).toBe(2);
  const strokes = opsOf(p, 'stroke').map((o) => o.args[0]);
  expect(strokes).toContain(darkGlow.accent);
  const head = Math.max(...points(p).map((pt) => pt.x));
  // 寫入直線就在最前端
  const vertical = opsOf(p, 'line').find((l) => l.args[0] === l.args[2]);
  expect(vertical?.args[0] as number).toBeGreaterThanOrEqual(head - 1e-6);
  expect(opsOf(p, 'circle').length).toBe(2);
});

test('registry exposes drum as number 8', () => {
  expect(looks.drum).toBe(drumLook);
  expect(drumLook).toMatchObject({ id: 'drum', number: 8 });
});

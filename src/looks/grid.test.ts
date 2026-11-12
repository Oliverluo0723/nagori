import { Midi } from '@tonejs/midi';
import { expect, test } from 'vitest';
import { makeMidi } from '../../test/fixtures/midi';
import { buildTempoMap, timeOfBar } from '../analysis/tempo';
import type { DrumHit, Readings } from '../analysis/types';
import { darkGlow } from '../compose/themes';
import { gridLook } from './grid';
import { RecordingPainter } from './painter/recording';
import type { LookContext } from './types';

const tempo = buildTempoMap(new Midi(makeMidi({ bpm: 120, tracks: [] })).header);
const W = 1080;
const H = 1920;
const ctx = (t: number, hits: DrumHit[], params: Record<string, number> = {}): LookContext => ({
  t,
  w: W,
  h: H,
  readings: { duration: 60, tempo, drums: hits, roles: [] } as Readings,
  theme: darkGlow,
  params,
  seed: 1,
  label: '02 GRID',
});
const kick = (time: number): DrumHit => ({ time, kind: 'kick', velocity: 1 });
const colX = (step: number) => W * 0.08 + (step + 0.5) * ((W * 0.84) / 16);
const circles = (p: RecordingPainter) => p.ops.filter((o) => o.op === 'circle');
// 格線的小點直徑是 h*0.004；hit 的圓都比它大
const hitCircles = (p: RecordingPainter) =>
  circles(p).filter((o) => (o.args[2] as number) > H * 0.005);

test('deterministic: same context gives identical ops', () => {
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  gridLook.draw(a, ctx(1, [kick(1)]));
  gridLook.draw(b, ctx(1, [kick(1)]));
  expect(a.ops).toEqual(b.ops);
});

test('a kick at 1.0 s (bar 1, step 8) sits in column 8 of row 0', () => {
  const p = new RecordingPainter();
  gridLook.draw(p, ctx(1, [kick(1)]));
  const c = hitCircles(p);
  expect(c).toHaveLength(1);
  expect(c[0].args[0]).toBeCloseTo(colX(8), 6);
  const rowH = (H * 0.72) / 4;
  expect(c[0].args[1]).toBeCloseTo(H * 0.14 + 0.5 * rowH, 6);
});

test('a hit exactly between two 16th steps lands in the same step on consecutive frames (review focus 4)', () => {
  // 120 bpm：一小節 2 s，一步 0.125 s；0.0625 s 正好在 step 0 與 1 中間
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  gridLook.draw(a, ctx(0.1, [kick(0.0625)]));
  gridLook.draw(b, ctx(0.11, [kick(0.0625)]));
  const xa = hitCircles(a)[0].args[0];
  const xb = hitCircles(b)[0].args[0];
  expect(xa).toBe(xb);
  // Math.round(0.5) = 1：正中間固定進位到 step 1
  expect(xa).toBeCloseTo(colX(1), 6);
});

test('rows=4 at bar 6 shows the page "bars 5–8"', () => {
  const p = new RecordingPainter();
  gridLook.draw(p, ctx(timeOfBar(tempo, 6) + 0.1, []));
  expect(p.ops.some((o) => o.op === 'text' && o.args[0] === 'bars 5–8')).toBe(true);
});

test('no drums: grid lines, playhead and label only', () => {
  const p = new RecordingPainter();
  gridLook.draw(p, ctx(0.5, []));
  expect(hitCircles(p)).toHaveLength(0);
  expect(p.ops.some((o) => o.op === 'line')).toBe(true);
  expect(p.ops.some((o) => o.op === 'text' && o.args[0] === '02 GRID')).toBe(true);
});

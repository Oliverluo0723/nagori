import { expect, test } from 'vitest';
import { makeCtx, opsOf } from '../../test/fixtures/looks';
import { tempoMapFromBpm, timeOfBar } from '../analysis/tempo';
import type { DrumHit } from '../analysis/types';
import { gridLayout, gridLook, LANES } from './grid';
import { RecordingPainter } from './painter/recording';

const W = 1080;
const H = 1920;
const tempo = tempoMapFromBpm(120);
const ctx = (t: number, hits: DrumHit[], params: Record<string, number> = {}) =>
  makeCtx(t, { drums: hits }, { w: W, h: H, params });
const kick = (time: number): DrumHit => ({ time, kind: 'kick', velocity: 1 });
const G = gridLayout(W, H, 8);
const texts = (p: RecordingPainter) => opsOf(p, 'text').map((o) => o.args[0]);
/** kick 的圓：圓心落在 kick 軌上 */
const kickCircles = (p: RecordingPainter, row = 0) =>
  opsOf(p, 'circle').filter(
    (o) => Math.abs((o.args[1] as number) - G.laneY(row, LANES.indexOf('kick'))) < 1e-6,
  );

test('deterministic: same context gives identical ops', () => {
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  gridLook.draw(a, ctx(1, [kick(1)]));
  gridLook.draw(b, ctx(1, [kick(1)]));
  expect(a.ops).toEqual(b.ops);
});

test('a kick at 1.0 s (bar 1, step 8) sits in column 8 of the kick lane of row 0', () => {
  const p = new RecordingPainter();
  gridLook.draw(p, ctx(1.5, [kick(1)]));
  const c = kickCircles(p);
  expect(c).toHaveLength(1);
  expect(c[0].args[0]).toBeCloseTo(G.colX(8), 6);
});

test('a hit exactly between two 16th steps lands in the same step on consecutive frames', () => {
  // 120 bpm：一小節 2 s，一步 0.125 s；0.0625 s 正好在 step 0 與 1 中間
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  gridLook.draw(a, ctx(0.3, [kick(0.0625)]));
  gridLook.draw(b, ctx(0.31, [kick(0.0625)]));
  const xa = kickCircles(a)[0].args[0];
  const xb = kickCircles(b)[0].args[0];
  expect(xa).toBe(xb);
  // Math.round(0.5) = 1：正中間固定進位到 step 1
  expect(xa).toBeCloseTo(G.colX(1), 6);
});

test('labels: step numbers 1–16, bar numbers of the page and the three lane names', () => {
  const p = new RecordingPainter();
  gridLook.draw(p, ctx(timeOfBar(tempo, 10) + 0.1, []));
  const all = texts(p);
  for (const s of ['1', '5', '13', '16', '9', '12', '16']) expect(all).toContain(s);
  expect(all).toContain('HAT');
  expect(all).toContain('SNARE');
  expect(all).toContain('KICK');
});

test('a hit not yet played is drawn faint; once played it is solid', () => {
  const before = new RecordingPainter();
  gridLook.draw(before, ctx(0.5, [kick(1.5)]));
  const after = new RecordingPainter();
  gridLook.draw(after, ctx(1.9, [kick(1.5)]));
  const alphaBefore = before.ops[before.ops.indexOf(kickCircles(before)[0]) - 1].args[1];
  const alphaAfter = after.ops[after.ops.indexOf(kickCircles(after)[0]) - 1].args[1];
  expect(alphaBefore as number).toBeLessThan(0.5);
  expect(alphaAfter as number).toBeGreaterThan(0.5);
});

test('readouts: PAGE / BAR / KICKS (this bar) / HITS (so far); rows=4 at bar 6 is page 5–8', () => {
  const hits = [kick(0.5), kick(10.1), kick(10.6), kick(30)];
  const r = gridLook.readouts?.(ctx(timeOfBar(tempo, 6) + 0.7, hits, { rows: 4 }));
  expect(r).toEqual([
    { label: 'PAGE', value: 'bars 5–8' },
    { label: 'BAR', value: '6.2' },
    { label: 'KICKS', value: '2' },
    { label: 'HITS', value: '3' },
  ]);
});

test('no drums: grid lines and playhead only, no hits', () => {
  const p = new RecordingPainter();
  gridLook.draw(p, ctx(0.5, []));
  expect(opsOf(p, 'circle')).toHaveLength(0);
  expect(opsOf(p, 'line').length).toBeGreaterThan(20);
});

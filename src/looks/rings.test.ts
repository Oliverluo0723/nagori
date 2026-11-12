import { Midi } from '@tonejs/midi';
import { expect, test } from 'vitest';
import { makeMidi } from '../../test/fixtures/midi';
import { buildTempoMap } from '../analysis/tempo';
import type { DrumHit, Readings } from '../analysis/types';
import { darkGlow, paperInk } from '../compose/themes';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';
import { ringsLook } from './rings';
import type { LookContext } from './types';

const tempo = buildTempoMap(new Midi(makeMidi({ bpm: 120, tracks: [] })).header);
const readings = (hits: DrumHit[]): Readings => ({ duration: 60, tempo, drums: hits, roles: [] });
const ctx = (t: number, hits: DrumHit[], theme = darkGlow): LookContext => ({
  t,
  w: 1080,
  h: 1920,
  readings: readings(hits),
  theme,
  params: {},
  seed: 1,
  label: '06 RINGS',
});

test('deterministic: same context gives identical ops', () => {
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  ringsLook.draw(a, ctx(1.2, [{ time: 1, kind: 'kick', velocity: 1 }]));
  ringsLook.draw(b, ctx(1.2, [{ time: 1, kind: 'kick', velocity: 1 }]));
  expect(a.ops).toEqual(b.ops);
});

test('a kick at now is a filled accent circle at the now line', () => {
  const p = new RecordingPainter();
  ringsLook.draw(p, ctx(1, [{ time: 1, kind: 'kick', velocity: 1 }]));
  const fills = p.ops.filter((o) => o.op === 'fill');
  expect(fills.some((o) => o.args[0] === '#ff4a1c')).toBe(true);
  const circle = p.ops.find((o) => o.op === 'circle');
  expect(circle?.args[0]).toBeCloseTo(1080 * 0.62);
});

test('snare is stroked not filled; hat is a line', () => {
  const p = new RecordingPainter();
  ringsLook.draw(
    p,
    ctx(1.1, [
      { time: 1, kind: 'snare', velocity: 1 },
      { time: 1.05, kind: 'hat', velocity: 1 },
    ]),
  );
  expect(p.ops.filter((o) => o.op === 'circle')).toHaveLength(1);
  expect(p.ops.filter((o) => o.op === 'line').length).toBeGreaterThanOrEqual(2); // 軸 + hat
});

test('hits older than fadeSeconds and future hits are not drawn', () => {
  const p = new RecordingPainter();
  ringsLook.draw(
    p,
    ctx(10, [
      { time: 1, kind: 'kick', velocity: 1 },
      { time: 20, kind: 'kick', velocity: 1 },
    ]),
  );
  expect(p.ops.filter((o) => o.op === 'circle')).toHaveLength(0);
});

test('paper theme never calls glow; empty drums still draws axis and label', () => {
  const p = new RecordingPainter();
  ringsLook.draw(p, ctx(3, [], paperInk));
  expect(p.ops.some((o) => o.op === 'glow')).toBe(false);
  expect(p.ops.some((o) => o.op === 'text' && o.args[0] === '06 RINGS')).toBe(true);
  expect(p.ops.some((o) => o.op === 'line')).toBe(true);
});

test('registry exposes rings by id', () => {
  expect(looks.rings).toBe(ringsLook);
  expect(ringsLook).toMatchObject({ id: 'rings', number: 6 });
});

test('t past every hit: axis and now line remain, no circles (review focus 5)', () => {
  const p = new RecordingPainter();
  ringsLook.draw(
    p,
    ctx(100, [
      { time: 1, kind: 'kick', velocity: 1 },
      { time: 2, kind: 'snare', velocity: 1 },
    ]),
  );
  expect(p.ops.filter((o) => o.op === 'circle')).toHaveLength(0);
  expect(p.ops.filter((o) => o.op === 'line')).toHaveLength(2);
  expect(p.ops[0]).toEqual({ op: 'background', args: ['#0f0f0f'] });
});

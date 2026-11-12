import { Midi } from '@tonejs/midi';
import { expect, test } from 'vitest';
import { makeMidi } from '../../test/fixtures/midi';
import { buildTempoMap } from '../analysis/tempo';
import type { ChordEvent, Readings } from '../analysis/types';
import { darkGlow, paperInk } from '../compose/themes';
import { bodiesLook } from './bodies';
import { RecordingPainter } from './painter/recording';
import type { LookContext } from './types';

const tempo = buildTempoMap(new Midi(makeMidi({ bpm: 120, tracks: [] })).header);
const Bm: ChordEvent = { time: 0, duration: 2, root: 11, name: 'Bm', notes: [2, 6, 11] };
const ctx = (t: number, chords?: ChordEvent[], theme = darkGlow): LookContext => ({
  t,
  w: 1080,
  h: 1920,
  readings: { duration: 60, tempo, drums: [], roles: [], chords } as Readings,
  theme,
  params: {},
  seed: 1,
  label: '05 BODIES',
});
const ellipses = (p: RecordingPainter) => p.ops.filter((o) => o.op === 'ellipse');

test('deterministic: same context gives identical ops', () => {
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  bodiesLook.draw(a, ctx(1, [Bm]));
  bodiesLook.draw(b, ctx(1, [Bm]));
  expect(a.ops).toEqual(b.ops);
});

test('a three-note chord is nine ellipses (three layers each)', () => {
  const p = new RecordingPainter();
  bodiesLook.draw(p, ctx(1, [Bm]));
  expect(ellipses(p)).toHaveLength(9);
  expect(p.ops.some((o) => o.op === 'text' && o.args[0] === 'Bm')).toBe(true);
});

test('within one chord the body centres do not move between frames', () => {
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  bodiesLook.draw(a, ctx(1, [Bm]));
  bodiesLook.draw(b, ctx(1.5, [Bm]));
  const centres = (p: RecordingPainter) => ellipses(p).map((o) => [o.args[0], o.args[1]]);
  expect(centres(a)).toEqual(centres(b));
});

test('paper theme never calls glow', () => {
  const p = new RecordingPainter();
  bodiesLook.draw(p, ctx(1, [Bm], paperInk));
  expect(p.ops.some((o) => o.op === 'glow')).toBe(false);
  expect(ellipses(p)).toHaveLength(9);
});

test('no chords: no ellipses, dash as the name (review focus 1)', () => {
  const p = new RecordingPainter();
  bodiesLook.draw(p, ctx(1));
  expect(ellipses(p)).toHaveLength(0);
  expect(p.ops.some((o) => o.op === 'text' && o.args[0] === '–')).toBe(true);
  expect(p.ops.some((o) => o.op === 'text' && o.args[0] === '05 BODIES')).toBe(true);
});

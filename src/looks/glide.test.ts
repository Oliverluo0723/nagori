import { Midi } from '@tonejs/midi';
import { expect, test } from 'vitest';
import { makeMidi } from '../../test/fixtures/midi';
import { buildTempoMap } from '../analysis/tempo';
import type { BassNote, Readings } from '../analysis/types';
import { darkGlow } from '../compose/themes';
import { glideLook } from './glide';
import { RecordingPainter } from './painter/recording';
import type { LookContext } from './types';

const tempo = buildTempoMap(new Midi(makeMidi({ bpm: 120, tracks: [] })).header);
const W = 1080;
const H = 1920;
const ctx = (t: number, bass?: BassNote[]): LookContext => ({
  t,
  w: W,
  h: H,
  readings: { duration: 60, tempo, drums: [], roles: [], bass } as Readings,
  theme: darkGlow,
  params: {},
  seed: 1,
  label: '03 GLIDE',
});
const D1: BassNote = { time: 0, duration: 1, midi: 26, bends: [] };
const texts = (p: RecordingPainter) => p.ops.filter((o) => o.op === 'text').map((o) => o.args[0]);
// 音域：min 26, max 26 → 擴 2 半音：24..28
const yOf = (midi: number, lo = 24, hi = 28) => H * 0.78 - ((midi - lo) / (hi - lo)) * H * 0.56;

test('deterministic: same context gives identical ops', () => {
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  glideLook.draw(a, ctx(0.5, [D1]));
  glideLook.draw(b, ctx(0.5, [D1]));
  expect(a.ops).toEqual(b.ops);
});

test('a sounding D1 is a horizontal segment at its pitch, a dot on the now line, and the name D1', () => {
  const p = new RecordingPainter();
  glideLook.draw(p, ctx(0.5, [D1]));
  const seg = p.ops.find(
    (o) =>
      o.op === 'line' &&
      Math.abs((o.args[1] as number) - yOf(26)) < 1e-6 &&
      Math.abs((o.args[3] as number) - yOf(26)) < 1e-6 &&
      (o.args[0] as number) < (o.args[2] as number),
  );
  expect(seg).toBeDefined();
  const dot = p.ops.find((o) => o.op === 'circle');
  expect(dot?.args[0]).toBeCloseTo(W * 0.62, 6);
  expect(dot?.args[1]).toBeCloseTo(yOf(26), 6);
  expect(texts(p)).toContain('D1');
});

test('a bent note is drawn as a polyline with bends + 2 points', () => {
  const bent: BassNote = {
    time: 0,
    duration: 1,
    midi: 26,
    bends: [
      { time: 0.25, semitones: 1 },
      { time: 0.5, semitones: 2 },
    ],
  };
  const p = new RecordingPainter();
  glideLook.draw(p, ctx(0.5, [bent]));
  const poly = p.ops.find((o) => o.op === 'polyline');
  expect(poly).toBeDefined();
  const pts = poly?.args[0] as unknown[] | undefined;
  expect(pts?.length).toBe(4);
});

test('no bass: grid lines and note names only, no dot (review focus 1)', () => {
  const p = new RecordingPainter();
  glideLook.draw(p, ctx(1));
  expect(p.ops.filter((o) => o.op === 'circle')).toHaveLength(0);
  expect(p.ops.some((o) => o.op === 'line')).toBe(true);
  expect(texts(p)).toContain('C2'); // 預設音域 24..48 裡的 C
  expect(texts(p)).toContain('03 GLIDE');
});

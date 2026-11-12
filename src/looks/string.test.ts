import { expect, test } from 'vitest';
import { tempoMapFromBpm } from '../analysis/tempo';
import type { DrumHit, Readings } from '../analysis/types';
import { darkGlow, paperInk } from '../compose/themes';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';
import { stringLook } from './string';
import type { LookContext } from './types';

const tempo = tempoMapFromBpm(120);
const ctx = (t: number, hits: DrumHit[], seed = 1, theme = darkGlow): LookContext => ({
  t,
  w: 1080,
  h: 1920,
  readings: { duration: 60, tempo, drums: hits, roles: [] } as Readings,
  theme,
  params: {},
  seed,
  label: '09 STRING',
});
const circles = (p: RecordingPainter) => p.ops.filter((o) => o.op === 'circle');
const polylines = (p: RecordingPainter) => p.ops.filter((o) => o.op === 'polyline');

const groove: DrumHit[] = [
  { time: 0, kind: 'kick', velocity: 1 },
  { time: 0.25, kind: 'hat', velocity: 0.5 },
  { time: 0.5, kind: 'snare', velocity: 0.9 },
  { time: 1, kind: 'kick', velocity: 1 },
];

test('deterministic for the same seed, different for another seed', () => {
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  const c = new RecordingPainter();
  stringLook.draw(a, ctx(2, groove));
  stringLook.draw(b, ctx(2, groove));
  stringLook.draw(c, ctx(2, groove, 2));
  expect(a.ops).toEqual(b.ops);
  expect(c.ops).not.toEqual(a.ops);
});

test('hats are not pins; kicks and snares are; the thread joins them in time order', () => {
  const p = new RecordingPainter();
  stringLook.draw(p, ctx(2, groove));
  expect(circles(p)).toHaveLength(3);
  const thread = polylines(p);
  const pts = thread.flatMap((o) => o.args[0] as { x: number; y: number }[]);
  // 三根釘，線段可能切成 ink 與 accent 兩段（共用一個接點）
  expect(pts.length).toBeGreaterThanOrEqual(3);
  const pins = circles(p).map((o) => ({ x: o.args[0] as number, y: o.args[1] as number }));
  expect(pts[0]).toEqual(pins[0]);
  expect(pts[pts.length - 1]).toEqual(pins[2]);
});

test('hits after t are not drawn; empty drums still draws label', () => {
  const p = new RecordingPainter();
  stringLook.draw(p, ctx(0.6, groove));
  expect(circles(p)).toHaveLength(2);
  const q = new RecordingPainter();
  stringLook.draw(q, ctx(5, [], 1, paperInk));
  expect(circles(q)).toHaveLength(0);
  expect(q.ops.some((o) => o.op === 'text' && o.args[0] === '09 STRING')).toBe(true);
  expect(q.ops.some((o) => o.op === 'glow')).toBe(false);
});

test('pins stay inside the canvas', () => {
  const p = new RecordingPainter();
  const many: DrumHit[] = [];
  for (let i = 0; i < 200; i++) {
    many.push({ time: i * 0.37, kind: i % 2 ? 'kick' : 'snare', velocity: (i % 7) / 6 });
  }
  stringLook.draw(p, ctx(100, many));
  for (const c of circles(p)) {
    expect(c.args[0]).toBeGreaterThan(0);
    expect(c.args[0]).toBeLessThan(1080);
    expect(c.args[1]).toBeGreaterThan(0);
    expect(c.args[1]).toBeLessThan(1920);
  }
});

test('registry exposes string as number 9', () => {
  expect(looks.string).toBe(stringLook);
  expect(stringLook).toMatchObject({ id: 'string', number: 9, listens: ['drums', 'tempo'] });
});

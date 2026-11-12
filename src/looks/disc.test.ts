import { expect, test } from 'vitest';
import { tempoMapFromBpm } from '../analysis/tempo';
import type { Readings, Spectrum } from '../analysis/types';
import { darkGlow, paperInk } from '../compose/themes';
import { discLook } from './disc';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';
import type { LookContext } from './types';

const tempo = tempoMapFromBpm(120);
const BINS = 8;
function flat(seconds: number, value: number, fps = 20): Spectrum {
  const frameCount = seconds * fps;
  return {
    fps,
    bins: BINS,
    minHz: 30,
    maxHz: 16000,
    frames: new Float32Array(frameCount * BINS).fill(value),
    frameCount,
  };
}
const W = 1080;
const H = 1920;
const ctx = (t: number, s?: Spectrum, theme = darkGlow): LookContext => ({
  t,
  w: W,
  h: H,
  readings: { duration: 40, tempo, drums: [], roles: [], spectrum: s } as Readings,
  theme,
  params: {},
  seed: 1,
  label: '12 DISC',
});
type Pt = { x: number; y: number };
const groovePoints = (p: RecordingPainter) =>
  p.ops.filter((o) => o.op === 'polyline').flatMap((o) => o.args[0] as Pt[]);

test('deterministic', () => {
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  discLook.draw(a, ctx(10, flat(40, 0.5)));
  discLook.draw(b, ctx(10, flat(40, 0.5)));
  expect(a.ops).toEqual(b.ops);
});

test('without spectrum: centre mark and label only', () => {
  const p = new RecordingPainter();
  discLook.draw(p, ctx(10, undefined, paperInk));
  expect(p.ops.filter((o) => o.op === 'circle')).toHaveLength(1);
  expect(p.ops.filter((o) => o.op === 'line')).toHaveLength(2);
  expect(p.ops.filter((o) => o.op === 'polyline')).toHaveLength(0);
  expect(p.ops.some((o) => o.op === 'text' && o.args[0] === '12 DISC')).toBe(true);
  expect(p.ops.some((o) => o.op === 'glow')).toBe(false);
});

test('silent groove spirals outward: radius never decreases, more points as t grows', () => {
  const p = new RecordingPainter();
  discLook.draw(p, ctx(10, flat(40, 0)));
  const pts = groovePoints(p);
  expect(pts.length).toBeGreaterThan(10);
  let prev = 0;
  for (const q of pts) {
    const r = Math.hypot(q.x - W / 2, q.y - H / 2);
    expect(r).toBeGreaterThanOrEqual(prev - 1e-6);
    prev = r;
  }
  const later = new RecordingPainter();
  discLook.draw(later, ctx(20, flat(40, 0)));
  expect(groovePoints(later).length).toBeGreaterThan(pts.length);
  const full = new RecordingPainter();
  discLook.draw(full, ctx(40, flat(40, 0)));
  const last = groovePoints(full).at(-1) as Pt;
  expect(Math.hypot(last.x - W / 2, last.y - H / 2)).toBeCloseTo(Math.min(W, H) * 0.42, -1);
});

test('loud groove wiggles; the last beat is in accent', () => {
  const p = new RecordingPainter();
  discLook.draw(p, ctx(10, flat(40, 0.8)));
  const pts = groovePoints(p);
  let wiggles = 0;
  let prev = 0;
  for (const q of pts) {
    const r = Math.hypot(q.x - W / 2, q.y - H / 2);
    if (r < prev) wiggles++;
    prev = r;
  }
  expect(wiggles).toBeGreaterThan(10);
  const colors = p.ops.filter((o) => o.op === 'stroke').map((o) => o.args[0]);
  expect(colors).toContain(darkGlow.ink);
  expect(colors).toContain(darkGlow.accent);
});

test('registry exposes disc as number 12', () => {
  expect(looks.disc).toBe(discLook);
  expect(discLook).toMatchObject({ id: 'disc', number: 12, listens: ['spectrum', 'tempo'] });
});

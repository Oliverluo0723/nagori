import { expect, test } from 'vitest';
import { tempoMapFromBpm } from '../analysis/tempo';
import type { DrumHit, Readings } from '../analysis/types';
import { darkGlow, paperInk } from '../compose/themes';
import { drumLook } from './drum';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';
import type { LookContext } from './types';

const tempo = tempoMapFromBpm(120); // 一小節 2 秒
const W = 1080;
const H = 1920;
const ctx = (
  t: number,
  hits: DrumHit[],
  params: Record<string, number> = {},
  theme = darkGlow,
): LookContext => ({
  t,
  w: W,
  h: H,
  readings: { duration: 64, tempo, drums: hits, roles: [] } as Readings,
  theme,
  params,
  seed: 1,
  label: '08 DRUM',
});
type Pt = { x: number; y: number };
const polylines = (p: RecordingPainter) => p.ops.filter((o) => o.op === 'polyline');
const points = (p: RecordingPainter) => polylines(p).flatMap((o) => o.args[0] as Pt[]);

test('deterministic', () => {
  const hits: DrumHit[] = [{ time: 1, kind: 'kick', velocity: 1 }];
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  drumLook.draw(a, ctx(3, hits));
  drumLook.draw(b, ctx(3, hits));
  expect(a.ops).toEqual(b.ops);
});

test('empty drums: a baseline per row, printed rows stay flat', () => {
  const p = new RecordingPainter();
  drumLook.draw(p, ctx(3, [], { barsPerRow: 4 }, paperInk));
  // 64 秒 / (4 小節 × 2 秒) = 8 列基線
  expect(p.ops.filter((o) => o.op === 'line')).toHaveLength(8);
  const pts = points(p);
  expect(pts.length).toBeGreaterThan(0);
  const y0 = pts[0].y;
  for (const pt of pts) expect(pt.y).toBeCloseTo(y0);
  expect(p.ops.some((o) => o.op === 'text' && o.args[0] === '08 DRUM')).toBe(true);
  expect(p.ops.some((o) => o.op === 'glow')).toBe(false);
});

test('a kick disturbs the line only after its own x; later rows are not printed', () => {
  const p = new RecordingPainter();
  drumLook.draw(p, ctx(3, [{ time: 1, kind: 'kick', velocity: 1 }], { barsPerRow: 4 }));
  const lines = polylines(p);
  // 只有第 1 列在印（ink 段 + accent 段）
  expect(lines.length).toBeLessThanOrEqual(2);
  const pts = points(p);
  const base = pts[0].y;
  const xKick = W * 0.1 + (1 / 8) * W * 0.84; // LEFT + 1 秒 / 8 秒
  const before = pts.filter((q) => q.x < xKick - 1);
  const after = pts.filter((q) => q.x > xKick + 1 && q.x < xKick + 60);
  for (const q of before) expect(q.y).toBeCloseTo(base);
  expect(after.some((q) => Math.abs(q.y - base) > 1)).toBe(true);
  // 印到 t = 3 秒為止
  const xT = W * 0.1 + (3 / 8) * W * 0.84;
  for (const q of pts) expect(q.x).toBeLessThanOrEqual(xT + 1);
});

test('last beat is drawn in accent, the rest in ink', () => {
  const p = new RecordingPainter();
  drumLook.draw(p, ctx(3, [{ time: 1, kind: 'snare', velocity: 1 }], { barsPerRow: 4 }));
  const colors = p.ops.filter((o) => o.op === 'stroke').map((o) => o.args[0]);
  expect(colors).toContain(darkGlow.ink);
  expect(colors).toContain(darkGlow.accent);
});

test('registry exposes drum as number 8', () => {
  expect(looks.drum).toBe(drumLook);
  expect(drumLook).toMatchObject({ id: 'drum', number: 8, listens: ['drums', 'tempo'] });
});

import { expect, test } from 'vitest';
import { makeCtx, opsOf } from '../../test/fixtures/looks';
import type { BassNote } from '../analysis/types';
import { displayRange, glideLook, midiHz, NOW_X, plotFrame } from './glide';
import { RecordingPainter } from './painter/recording';

const W = 1080;
const H = 1920;
const D1: BassNote = { time: 0, duration: 1, midi: 26, bends: [] };
const texts = (p: RecordingPainter) => opsOf(p, 'text').map((o) => o.args[0]);
const ctx = (t: number, bass?: BassNote[]) => makeCtx(t, { bass }, { w: W, h: H });
const F = plotFrame(W, H);
const nowX = F.x0 + (F.x1 - F.x0) * NOW_X;
function yOf(midi: number, bass: BassNote[]) {
  const [lo, hi] = displayRange(bass);
  return F.y1 - ((midi - lo) / (hi - lo)) * (F.y1 - F.y0);
}

test('deterministic: same context gives identical ops', () => {
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  glideLook.draw(a, ctx(0.5, [D1]));
  glideLook.draw(b, ctx(0.5, [D1]));
  expect(a.ops).toEqual(b.ops);
});

test('the pitch grid spans at least two octaves around the bass, labelled with C and G names', () => {
  const [lo, hi] = displayRange([D1]);
  expect(hi - lo).toBeGreaterThanOrEqual(24);
  expect(lo).toBeLessThanOrEqual(24);
  const p = new RecordingPainter();
  glideLook.draw(p, ctx(0.5, [D1]));
  const all = texts(p);
  expect(all).toContain('C1');
  expect(all).toContain('G1');
  expect(all).toContain('C2');
  // 半音一條線：至少 24 條橫線
  const horizontal = opsOf(p, 'line').filter((o) => o.args[1] === o.args[3]);
  expect(horizontal.length).toBeGreaterThanOrEqual(24);
});

test('a sounding D1 is an accent path at its pitch, a ring on the now line and the big name D1', () => {
  const p = new RecordingPainter();
  glideLook.draw(p, ctx(0.5, [D1]));
  const y = yOf(26, [D1]);
  const path = opsOf(p, 'polyline').find((o) =>
    (o.args[0] as { y: number }[]).every((pt) => Math.abs(pt.y - y) < 1e-6),
  );
  expect(path).toBeDefined();
  const ring = opsOf(p, 'circle')[0];
  expect(ring.args[0]).toBeCloseTo(nowX, 6);
  expect(ring.args[1]).toBeCloseTo(y, 6);
  const name = opsOf(p, 'text').find(
    (o) => o.args[0] === 'D1' && (o.args[3] as { font: string }).font === 'sans',
  );
  expect(name).toBeDefined();
});

test('a bend becomes extra vertices on the path', () => {
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
  glideLook.draw(p, ctx(0.9, [bent]));
  const longest = Math.max(...opsOf(p, 'polyline').map((o) => (o.args[0] as unknown[]).length));
  expect(longest).toBeGreaterThanOrEqual(4);
});

test('back-to-back notes are joined by a vertical jump at the second note', () => {
  const a: BassNote = { time: 0, duration: 0.5, midi: 26, bends: [] };
  const b: BassNote = { time: 0.5, duration: 0.5, midi: 31, bends: [] };
  const p = new RecordingPainter();
  glideLook.draw(p, ctx(0.9, [a, b]));
  const ys = [yOf(26, [a, b]), yOf(31, [a, b])];
  const joined = opsOf(p, 'polyline').some((o) => {
    const pts = o.args[0] as { x: number; y: number }[];
    return (
      Math.abs(pts[0].y - ys[0]) < 1e-6 &&
      Math.abs(pts[1].y - ys[1]) < 1e-6 &&
      pts[0].x === pts[1].x
    );
  });
  expect(joined).toBe(true);
});

test('no bass: grid and note names only, no ring', () => {
  const p = new RecordingPainter();
  glideLook.draw(p, ctx(1));
  expect(opsOf(p, 'circle')).toHaveLength(0);
  expect(texts(p)).toContain('C2'); // 預設音域 24..48 裡的 C
});

test('readouts: NOTE / FREQUENCY / RANGE / WINDOW', () => {
  const r = glideLook.readouts?.(ctx(0.5, [D1, { time: 1, duration: 1, midi: 45, bends: [] }]));
  expect(r?.map((c) => c.label)).toEqual(['NOTE', 'FREQUENCY', 'RANGE', 'WINDOW']);
  expect(r?.[0].value).toBe('D1');
  expect(r?.[1].value).toBe(`${midiHz(26).toFixed(1)} Hz`);
  expect(r?.[1].value).toBe('36.7 Hz');
  expect(r?.[2].value).toBe('D1 – A2');
  expect(r?.[3].value).toBe('8.0 s'); // 120 bpm、4 小節
});

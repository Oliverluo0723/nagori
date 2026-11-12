import { expect, test } from 'vitest';
import { makeCtx } from '../../test/fixtures/looks';
import { tempoMapFromBpm } from '../analysis/tempo';
import type { NoteEvent } from '../analysis/types';
import { darkGlow, paperInk } from '../compose/themes';
import { RecordingPainter } from './painter/recording';
import { readoutsFor } from './readouts';
import { looks } from './registry';
import { isBlackKey, MAX_ROWS, NOW_X, rollLook, rollRange, soundingAt } from './roll';

const note = (time: number, midi: number, duration = 0.5, velocity = 1): NoteEvent => ({
  time,
  duration,
  midi,
  velocity,
});

/** 走一遍 ops，記下每個 rect 畫的時候的 fill 色與 alpha */
function rects(p: RecordingPainter) {
  let fill: { color: string; alpha: number } | null = null;
  const out: { x: number; y: number; w: number; h: number; color: string; alpha: number }[] = [];
  for (const o of p.ops) {
    if (o.op === 'fill')
      fill = { color: o.args[0] as string, alpha: (o.args[1] as number | undefined) ?? 1 };
    else if (o.op === 'noFill') fill = null;
    else if (o.op === 'rect' && fill) {
      const [x, y, w, h] = o.args as number[];
      out.push({ x, y, w, h, ...fill });
    }
  }
  return out;
}

const accentRects = (p: RecordingPainter, theme = darkGlow) =>
  rects(p).filter((r) => r.color === theme.accent);

// 120 BPM 4/4：一小節 2 秒
const tempo = tempoMapFromBpm(120);
const draw = (t: number, notes: NoteEvent[], extra = {}) => {
  const p = new RecordingPainter();
  rollLook.draw(p, makeCtx(t, { tempo, notes }, extra));
  return p;
};

test('registered as 25 鋼琴捲, listening to notes and tempo', () => {
  expect(looks.roll).toBe(rollLook);
  expect(rollLook.number).toBe(25);
  expect(rollLook.name).toBe('鋼琴捲');
  expect(rollLook.listens).toEqual(['notes', 'tempo']);
});

test('deterministic: same context gives identical ops', () => {
  const notes = [note(0, 60), note(1, 64), note(2.5, 67)];
  expect(draw(1.2, notes).ops).toEqual(draw(1.2, notes).ops);
});

test('row range: lowest to highest note ±2 semitones, default 36–72 without notes', () => {
  expect(rollRange([])).toEqual([36, 72]);
  expect(rollRange([note(0, 50), note(1, 62)])).toEqual([48, 64]);
});

test('row range over 48 rows keeps the 48 rows holding the most notes', () => {
  const notes = [
    note(0, 20),
    ...Array.from({ length: 30 }, (_, i) => note(i, 60 + (i % 40))),
    note(40, 110),
  ];
  const [lo, hi] = rollRange(notes);
  expect(hi - lo + 1).toBe(MAX_ROWS);
  expect(lo).toBeLessThanOrEqual(60);
  expect(hi).toBeGreaterThanOrEqual(60 + 29);
});

test('sounding note is solid accent, past notes 0.55, future notes 0.35', () => {
  const notes = [note(0, 60), note(1, 62), note(2, 64)];
  const ar = accentRects(draw(1.2, notes));
  const alphas = ar.map((r) => r.alpha);
  expect(alphas).toContain(0.55);
  expect(alphas).toContain(0.35);
  expect(alphas).toContain(1);
});

test('a note starting now begins at the now line (38% from the left)', () => {
  const p = draw(2, [note(2, 60, 1)], { theme: paperInk });
  const r = accentRects(p, paperInk).find((x) => x.alpha === 1 && x.w > 1);
  expect(r?.x).toBeCloseTo(1080 * NOW_X, 6);
});

test('notes scroll left as time goes on, by bars not seconds', () => {
  const notes = [note(4, 60, 0.5)];
  const at = (t: number) => accentRects(draw(t, notes, { theme: paperInk }), paperInk)[0].x;
  const a = at(2);
  const b = at(3);
  expect(b).toBeLessThan(a);
  // bars = 2 → 視窗寬（扣掉琴鍵）是兩小節；一秒 = 半小節 = 視窗的 1/4
  const half = at(2) - at(3);
  expect(half * 4).toBeGreaterThan(1080 * 0.85);
  expect(half * 4).toBeLessThan(1080);
});

test('velocity changes the height, not the colour', () => {
  const loud = accentRects(draw(5, [note(6, 60, 0.5, 1)]))[0];
  const soft = accentRects(draw(5, [note(6, 60, 0.5, 0)]))[0];
  expect(loud.color).toBe(soft.color);
  expect(loud.alpha).toBe(soft.alpha);
  expect(soft.h).toBeCloseTo(loud.h / 2, 6);
});

test('higher notes are drawn higher up', () => {
  const ar = accentRects(draw(5, [note(6, 60), note(6.5, 67)]));
  expect(ar[1].y).toBeLessThan(ar[0].y);
});

test('no notes: draws the empty roll without crashing', () => {
  const p = draw(3, []);
  expect(p.ops.length).toBeGreaterThan(10);
  expect(accentRects(p).filter((r) => r.alpha < 1)).toHaveLength(0);
});

test('works in a small wide cell', () => {
  const p = draw(1, [note(0.5, 60), note(1.5, 64)], { w: 540, h: 300 });
  for (const r of rects(p)) {
    expect(r.x).toBeGreaterThanOrEqual(-1e-6);
    expect(r.x + r.w).toBeLessThanOrEqual(540 + 1e-6);
  }
});

test('helpers: black keys and sounding notes', () => {
  expect([60, 61, 62, 63, 64, 65, 66].map(isBlackKey)).toEqual([
    false,
    true,
    false,
    true,
    false,
    false,
    true,
  ]);
  const notes = [note(0, 60, 1), note(0.5, 64, 0.2), note(2, 67)];
  expect(soundingAt(notes, 0.6).map((n) => n.midi)).toEqual([60, 64]);
});

test('readouts: WINDOW, NOTES sounding/total, RANGE, SOURCE', () => {
  const notes = [note(0, 50, 1), note(0.5, 62, 1), note(3, 55)];
  const ctx = makeCtx(0.7, {
    tempo,
    notes,
    source: {
      tempo: 'audio',
      drums: 'none',
      chords: 'none',
      bass: 'none',
      key: 'none',
      notes: 'audio',
    },
  });
  expect(readoutsFor(rollLook, ctx)).toEqual([
    { label: 'WINDOW', value: '2 bars' },
    { label: 'NOTES', value: '2/3' },
    { label: 'RANGE', value: 'C3–E4' },
    { label: 'SOURCE', value: 'audio' },
  ]);
});

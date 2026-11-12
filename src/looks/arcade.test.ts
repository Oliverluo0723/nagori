import { expect, test } from 'vitest';
import { hasText, makeCtx } from '../../test/fixtures/looks';
import { tempoMapFromBpm } from '../analysis/tempo';
import type { NoteEvent } from '../analysis/types';
import { darkGlow, paperInk } from '../compose/themes';
import { arcadeLook, chartOf, MAX_LANES, scoreAt } from './arcade';
import { noteColor } from './music';
import { RecordingPainter } from './painter/recording';
import { readoutsFor } from './readouts';
import { looks } from './registry';

const note = (time: number, midi: number, duration = 0.25): NoteEvent => ({
  time,
  duration,
  midi,
  velocity: 0.8,
});
// 120 BPM：一拍 0.5 秒
const tempo = tempoMapFromBpm(120);
const draw = (t: number, notes: NoteEvent[], extra = {}) => {
  const p = new RecordingPainter();
  arcadeLook.draw(p, makeCtx(t, { tempo, notes }, extra));
  return p;
};

test('registered as 26 街機, listening to notes and tempo', () => {
  expect(looks.arcade).toBe(arcadeLook);
  expect(arcadeLook.number).toBe(26);
  expect(arcadeLook.name).toBe('街機');
  expect(arcadeLook.listens).toEqual(['notes', 'tempo']);
});

test('deterministic: same context gives identical ops', () => {
  const notes = [note(0, 60), note(0.5, 64), note(1, 67)];
  expect(draw(0.6, notes).ops).toEqual(draw(0.6, notes).ops);
});

test('lanes are the distinct pitches low to high', () => {
  const c = chartOf([note(0, 67), note(1, 60), note(2, 64), note(3, 60)], tempo);
  expect(c.lanes).toEqual([60, 64, 67]);
});

test('more than 12 pitches → the 12 most frequent, sorted by pitch', () => {
  const notes: NoteEvent[] = [];
  let t = 0;
  for (let m = 40; m < 60; m++) {
    const times = m >= 48 ? 3 : 1; // 48..59 出現三次
    for (let k = 0; k < times; k++) {
      t += 0.5;
      notes.push(note(t, m, 0.1));
    }
  }
  const sorted = [...notes].sort((a, b) => a.time - b.time);
  const c = chartOf(sorted, tempo);
  expect(c.lanes).toHaveLength(MAX_LANES);
  expect(c.lanes).toEqual(Array.from({ length: 12 }, (_, i) => 48 + i));
});

test('score: each passed note gives 100 + 10·combo; a gap over one beat resets combo', () => {
  // 0、0.5、1.0 連著（間隔 ≤ 一拍），3.0 前面空了 1.75 秒 > 0.5 秒 → combo 從 1 開始
  const notes = [note(0, 60), note(0.5, 62), note(1, 64), note(3, 60)];
  const c = chartOf(notes, tempo);
  expect(c.combo).toEqual([1, 2, 3, 1]);
  expect(scoreAt(c, tempo, -1)).toEqual({ score: 0, combo: 0 });
  expect(scoreAt(c, tempo, 1.1)).toEqual({ score: 110 + 120 + 130, combo: 3 });
  // 2.5 秒：離上一顆尾巴（1.25）超過一拍 → combo 歸零，分數不變
  expect(scoreAt(c, tempo, 2.5)).toEqual({ score: 360, combo: 0 });
  expect(scoreAt(c, tempo, 3.1)).toEqual({ score: 360 + 110, combo: 1 });
});

test('a note reaching the judgment line flashes its circle for 0.15 s in the lane colour', () => {
  const notes = [note(1, 62), note(1, 69)];
  const colour = noteColor(darkGlow, 62 % 12);
  const filledCircles = (p: RecordingPainter) => {
    let fill: string | null = null;
    const out: string[] = [];
    for (const o of p.ops) {
      if (o.op === 'fill') fill = o.args[0] as string;
      else if (o.op === 'noFill') fill = null;
      else if (o.op === 'circle' && fill) out.push(fill);
    }
    return out;
  };
  expect(filledCircles(draw(1.05, notes))).toContain(colour);
  const glowsAtHit = draw(1.05, notes).ops.filter((o) => o.op === 'glow').length;
  const glowsLater = draw(1.2, notes).ops.filter((o) => o.op === 'glow').length;
  expect(glowsAtHit).toBe(2);
  expect(glowsLater).toBe(0);
});

test('notes beyond the lookahead are not drawn; inside it they are', () => {
  const far = draw(0, [note(3, 60)], { params: { lookahead: 2 } });
  const near = draw(0, [note(1.5, 60)], { params: { lookahead: 2 } });
  const colour = noteColor(darkGlow, 0);
  const shapesIn = (p: RecordingPainter) => {
    let fill: string | null = null;
    let n = 0;
    for (const o of p.ops) {
      if (o.op === 'fill') fill = o.args[0] as string;
      else if (o.op === 'shape' && fill === colour) n++;
    }
    return n;
  };
  // 地板那塊 lane 也是同色 shape：多出來的才是音符
  expect(shapesIn(near)).toBeGreaterThan(shapesIn(far));
});

test('keys are labelled with note names', () => {
  const p = draw(0, [note(0.2, 38), note(0.4, 62)], { theme: paperInk });
  expect(hasText(p, 'D2')).toBe(true);
  expect(hasText(p, 'D4')).toBe(true);
});

test('no notes: still draws, score 0', () => {
  const p = draw(5, []);
  expect(p.ops.length).toBeGreaterThan(5);
  expect(hasText(p, '0000000')).toBe(true);
});

test('fits a small wide cell', () => {
  const p = draw(1, [note(0.5, 60), note(1.2, 64)], { w: 540, h: 300 });
  for (const o of p.ops)
    if (o.op === 'rect') {
      const [x, y, w, h] = o.args as number[];
      expect(x).toBeGreaterThanOrEqual(-1e-6);
      expect(x + w).toBeLessThanOrEqual(540 + 1e-6);
      expect(y + h).toBeLessThanOrEqual(300 + 1e-6);
    }
});

test('readouts: SCORE, COMBO, LANES Notes · n, PART Track', () => {
  const notes = [note(0, 60), note(0.5, 62), note(1, 64)];
  expect(readoutsFor(arcadeLook, makeCtx(1.1, { tempo, notes }))).toEqual([
    { label: 'SCORE', value: '360' },
    { label: 'COMBO', value: '3' },
    { label: 'LANES', value: 'Notes · 3' },
    { label: 'PART', value: 'Track' },
  ]);
});

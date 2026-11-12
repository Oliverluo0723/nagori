import { expect, test } from 'vitest';
import type { BassNote, ChordEvent, DrumHit } from '../src/analysis/types';
import { chordRootAccuracy, drumF1, noteF1, pitchTimeAccuracy } from './metrics';

const note = (time: number, midi: number, duration = 0.5): BassNote => ({
  time,
  midi,
  duration,
  bends: [],
});

test('noteF1 is 1 for identical lists', () => {
  const notes = [note(0, 35), note(0.5, 31), note(1, 38)];
  expect(noteF1(notes, notes)).toMatchObject({ precision: 1, recall: 1, f1: 1, octaveErrors: 0 });
});

test('noteF1: onset within 50 ms still matches, 80 ms does not', () => {
  const truth = [note(1, 35)];
  expect(noteF1([note(1.04, 35)], truth).f1).toBe(1);
  expect(noteF1([note(1.08, 35)], truth).f1).toBe(0);
});

test('noteF1: an octave error is not a hit but is counted', () => {
  const r = noteF1([note(1, 47)], [note(1, 35)]);
  expect(r.f1).toBe(0);
  expect(r.octaveErrors).toBe(1);
});

test('noteF1: precision and recall differ when counts differ', () => {
  const r = noteF1([note(0, 35), note(0.5, 31)], [note(0, 35)]);
  expect(r.precision).toBe(0.5);
  expect(r.recall).toBe(1);
  expect(r.f1).toBeCloseTo(2 / 3, 5);
});

test('noteF1 with empty inputs is 0, not NaN', () => {
  expect(noteF1([], []).f1).toBe(0);
  expect(noteF1([], [note(0, 35)]).f1).toBe(0);
});

test('chordRootAccuracy is duration-weighted', () => {
  const chord = (time: number, duration: number, root: number): ChordEvent => ({
    time,
    duration,
    root,
    name: 'x',
    notes: [root],
  });
  const truth = [
    { time: 0, duration: 2, root: 2 },
    { time: 2, duration: 2, root: 9 },
  ];
  // 前半對、後半錯
  expect(chordRootAccuracy([chord(0, 2, 2), chord(2, 2, 0)], truth)).toBe(0.5);
  // 時間錯位：0–1 沒有預測，1–2 對，2–3 預測 2 但真值 9（錯），3–4 錯 → 1/4
  expect(chordRootAccuracy([chord(1, 2, 2), chord(3, 1, 0)], truth)).toBe(0.25);
});

test('pitchTimeAccuracy: share of truth-voiced time where the predicted pitch matches', () => {
  // 真值 0–1 s midi 35、1–2 s midi 31；預測把 0–2 s 全報成 35 → 前半對、後半錯
  const truth = [
    { time: 0, duration: 1, midi: 35 },
    { time: 1, duration: 1, midi: 31 },
  ];
  expect(pitchTimeAccuracy([note(0, 35, 2)], truth)).toBeCloseTo(0.5, 2);
  // 同一個音被切成兩段仍然全對（分段方式不影響）
  expect(pitchTimeAccuracy([note(0, 35, 1), note(1, 31, 1)], truth)).toBeCloseTo(1, 2);
  expect(pitchTimeAccuracy([], truth)).toBe(0);
});

test('drumF1 per kind with 50 ms tolerance', () => {
  const hit = (time: number, kind: DrumHit['kind']): DrumHit => ({ time, kind, velocity: 1 });
  const truth = [hit(0, 'kick'), hit(0.5, 'snare'), hit(1, 'kick'), hit(1, 'hat')];
  const pred = [hit(0.02, 'kick'), hit(0.5, 'snare'), hit(1.2, 'kick'), hit(1, 'hat'), hit(1.5, 'hat')];
  const r = drumF1(pred, truth);
  expect(r.kick).toBeCloseTo(0.5, 5); // 1 of 2 matched, 2 predicted → p .5 r .5
  expect(r.snare).toBe(1);
  expect(r.hat).toBeCloseTo(2 / 3, 5); // p .5 r 1
});

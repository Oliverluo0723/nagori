import { expect, test } from 'vitest';
import type { NoteEvent } from '../types';
import { fromBasicPitch, resampleForBasicPitch, thresholdsKey, tidyNotes } from './notes';

const n = (time: number, duration: number, midi: number, velocity = 0.5): NoteEvent => ({
  time,
  duration,
  midi,
  velocity,
});

test('44.1 kHz → 22.05 kHz averages sample pairs', () => {
  const out = resampleForBasicPitch(Float32Array.from([0, 1, 1, 1, -1, 0, 5]), 44100);
  expect(Array.from(out)).toEqual([0.5, 1, -0.5]);
});

test('22.05 kHz is copied, other rates are interpolated to the right length', () => {
  const src = Float32Array.from([1, 2, 3]);
  const same = resampleForBasicPitch(src, 22050);
  expect(Array.from(same)).toEqual([1, 2, 3]);
  expect(same).not.toBe(src);
  expect(resampleForBasicPitch(new Float32Array(48000), 48000).length).toBe(22050);
});

test('tidyNotes sorts by time and trims overlapping notes of the same pitch', () => {
  const out = tidyNotes([n(1, 1, 60), n(0, 2, 60), n(0.5, 0.2, 64)]);
  expect(out).toEqual([n(0, 1, 60), n(0.5, 0.2, 64), n(1, 1, 60)]);
});

test('tidyNotes keeps the longer of two notes starting together on one pitch', () => {
  expect(tidyNotes([n(0, 0.5, 60), n(0, 1, 60)])).toEqual([n(0, 1, 60)]);
});

test('tidyNotes clamps velocity and midi, rounds midi and drops empty / broken notes', () => {
  const out = tidyNotes([n(-0.5, 1, 60.4, 2), n(1, 0, 60), n(2, 1, 200, -1), n(3, Number.NaN, 60)]);
  expect(out).toEqual([n(0, 0.5, 60, 1), n(2, 1, 127, 0)]);
});

test('tidyNotes does not mutate its input', () => {
  const input = [n(0, 2, 60), n(1, 1, 60)];
  tidyNotes(input);
  expect(input[0].duration).toBe(2);
});

test('fromBasicPitch maps amplitude to velocity and tidies', () => {
  const out = fromBasicPitch([
    { startTimeSeconds: 0.5, durationSeconds: 0.3, pitchMidi: 62, amplitude: 1.3 },
    { startTimeSeconds: 0.1, durationSeconds: 0.2, pitchMidi: 38, amplitude: 0.4 },
  ]);
  expect(out).toEqual([n(0.1, 0.2, 38, 0.4), n(0.5, 0.3, 62, 1)]);
});

test('thresholdsKey changes with every threshold', () => {
  const a = thresholdsKey({ onset: 0.5, frame: 0.3, minFrames: 11 });
  expect(a).not.toBe(thresholdsKey({ onset: 0.6, frame: 0.3, minFrames: 11 }));
  expect(a).not.toBe(thresholdsKey({ onset: 0.5, frame: 0.2, minFrames: 11 }));
  expect(a).not.toBe(thresholdsKey({ onset: 0.5, frame: 0.3, minFrames: 9 }));
});

import { expect, test } from 'vitest';
import { mergeReadings } from './merge';
import { tempoMapFromBpm } from './tempo';
import type { Readings, ReadingsSource } from './types';

const midiOnlyDrums: Readings = {
  duration: 10,
  tempo: tempoMapFromBpm(100),
  drums: [{ time: 0, kind: 'kick', velocity: 1 }],
  roles: [],
  chords: [],
  bass: [],
  key: undefined,
  source: { tempo: 'midi', drums: 'midi', chords: 'none', bass: 'none', key: 'none' },
};

const audio: Readings = {
  duration: 12,
  tempo: tempoMapFromBpm(99.5, 0.2),
  drums: [{ time: 0.5, kind: 'snare', velocity: 1 }],
  roles: [],
  chords: [{ time: 0, duration: 2, root: 2, name: 'D', notes: [2, 6, 9] }],
  bass: [{ time: 0, duration: 1, midi: 38, bends: [] }],
  key: { tonic: 2, mode: 'major', name: 'D major' },
  spectrum: {
    fps: 50,
    bins: 64,
    minHz: 30,
    maxHz: 16000,
    frames: new Float32Array(64),
    frameCount: 1,
  },
  source: { tempo: 'audio', drums: 'audio', chords: 'audio', bass: 'audio', key: 'audio' },
};

test('MIDI with drums only: drums and tempo from MIDI, chords/bass/key from audio (review focus 5)', () => {
  const r = mergeReadings(midiOnlyDrums, audio);
  expect(r.tempo).toBe(midiOnlyDrums.tempo);
  expect(r.drums).toBe(midiOnlyDrums.drums);
  expect(r.chords).toBe(audio.chords);
  expect(r.bass).toBe(audio.bass);
  expect(r.key).toBe(audio.key);
  expect(r.spectrum).toBe(audio.spectrum);
  expect(r.duration).toBe(12);
  expect(r.source).toEqual({
    tempo: 'midi',
    drums: 'midi',
    chords: 'audio',
    bass: 'audio',
    key: 'audio',
    notes: 'none',
  });
});

test('audio only and midi only pass through', () => {
  expect(mergeReadings(undefined, audio)).toBe(audio);
  expect(mergeReadings(midiOnlyDrums, undefined)).toBe(midiOnlyDrums);
});

const note = (time: number, midi: number) => ({ time, duration: 0.5, midi, velocity: 0.8 });

test('notes: MIDI notes win over transcribed ones', () => {
  const midi: Readings = {
    ...midiOnlyDrums,
    notes: [note(0, 60)],
    source: { ...(midiOnlyDrums.source as ReadingsSource), notes: 'midi' },
  };
  const a: Readings = {
    ...audio,
    notes: [note(1, 62), note(2, 64)],
    source: { ...(audio.source as ReadingsSource), notes: 'audio' },
  };
  const r = mergeReadings(midi, a);
  expect(r.notes).toBe(midi.notes);
  expect(r.source?.notes).toBe('midi');
});

test('notes: MIDI without notes falls back to transcribed notes and their source', () => {
  const a: Readings = {
    ...audio,
    notes: [note(1, 62)],
    source: { ...(audio.source as ReadingsSource), notes: 'stem' },
  };
  const r = mergeReadings({ ...midiOnlyDrums, notes: [] }, a);
  expect(r.notes).toBe(a.notes);
  expect(r.source?.notes).toBe('stem');
});

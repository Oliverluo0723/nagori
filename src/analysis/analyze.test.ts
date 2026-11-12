import { expect, test } from 'vitest';
import { makeMidi } from '../../test/fixtures/midi';
import { analyzeMidi } from './analyze';

test('analyzeMidi collects hits from every drums track, sorted by time', () => {
  const bytes = makeMidi({
    bpm: 120,
    tracks: [
      { name: 'Kick', notes: [{ beat: 2, midi: 36 }] },
      { name: 'x', channel: 9, notes: [{ beat: 0, midi: 42 }] },
      { name: 'Bass', notes: [{ beat: 0, midi: 40 }] },
    ],
  });
  const r = analyzeMidi(bytes, 30);
  expect(r.drums.map((h) => [h.time, h.kind])).toEqual([
    [0, 'hat'],
    [1, 'kick'],
  ]);
  expect(r.duration).toBe(30);
  expect(r.roles.map((x) => x.role)).toEqual(['drums', 'drums', 'bass']);
});

test('no drums track gives empty drums, not an error', () => {
  const r = analyzeMidi(makeMidi({ tracks: [{ name: 'Bass', notes: [{ beat: 0, midi: 40 }] }] }));
  expect(r.drums).toEqual([]);
});

test('analyzeMidi fills chords, bass and key when the tracks exist', () => {
  const bytes = makeMidi({
    bpm: 120,
    keySignature: { key: 'B', scale: 'minor' },
    tracks: [
      { name: 'Drums', notes: [{ beat: 0, midi: 36 }] },
      { name: 'Bass', notes: [{ beat: 0, midi: 35, durationBeats: 4 }] },
      {
        name: 'Pad',
        notes: [59, 62, 66].map((midi) => ({ beat: 0, midi, durationBeats: 4 })),
      },
    ],
  });
  const r = analyzeMidi(bytes, 4);
  expect(r.chords?.[0]).toMatchObject({ name: 'Bm', root: 11 });
  expect(r.bass?.[0]).toMatchObject({ midi: 35 });
  expect(r.key).toEqual({ tonic: 11, mode: 'minor', name: 'B minor' });
});

test('drums-only MIDI leaves chords/bass empty and key undefined', () => {
  const r = analyzeMidi(makeMidi({ tracks: [{ name: 'Drums', notes: [{ beat: 0, midi: 36 }] }] }));
  expect(r.chords).toEqual([]);
  expect(r.bass).toEqual([]);
  expect(r.key).toBeUndefined();
});

test('a non-finite duration hint is ignored and analysis terminates (reviewer finding)', () => {
  const bytes = makeMidi({
    bpm: 120,
    tracks: [
      { name: 'Pad', notes: [59, 62, 66].map((midi) => ({ beat: 0, midi, durationBeats: 4 })) },
    ],
  });
  const r = analyzeMidi(bytes, Number.POSITIVE_INFINITY);
  expect(Number.isFinite(r.duration)).toBe(true);
  expect(r.chords).toHaveLength(1);
  const n = analyzeMidi(bytes, Number.NaN);
  expect(Number.isFinite(n.duration)).toBe(true);
});

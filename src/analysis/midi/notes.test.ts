import { expect, test } from 'vitest';
import { makeMidi } from '../../../test/fixtures/midi';
import { analyzeMidi } from '../analyze';

test('analyzeMidi flattens every non-drum track into notes, bass included', () => {
  const bytes = makeMidi({
    bpm: 120,
    tracks: [
      { name: 'Drums', channel: 9, notes: [{ beat: 0, midi: 36 }] },
      { name: 'Bass', notes: [{ beat: 1, midi: 38, durationBeats: 1, velocity: 0.8 }] },
      {
        name: 'Pad',
        notes: [62, 66, 69].map((midi) => ({ beat: 0, midi, durationBeats: 2 })),
      },
    ],
  });
  const r = analyzeMidi(bytes);
  expect(r.notes?.map((x) => [x.time, x.midi])).toEqual([
    [0, 62],
    [0, 66],
    [0, 69],
    [0.5, 38],
  ]);
  const bass = r.notes?.find((x) => x.midi === 38);
  expect(bass?.duration).toBeCloseTo(0.5);
  expect(bass?.velocity).toBeCloseTo(0.8, 1);
  expect(r.source?.notes).toBe('midi');
});

test('drums-only MIDI has no notes', () => {
  const r = analyzeMidi(makeMidi({ tracks: [{ name: 'Kick', notes: [{ beat: 0, midi: 36 }] }] }));
  expect(r.notes).toEqual([]);
  expect(r.source?.notes).toBe('none');
});

test('overlapping notes of one pitch across tracks do not overlap in notes', () => {
  const r = analyzeMidi(
    makeMidi({
      tracks: [
        { name: 'Lead', notes: [{ beat: 0, midi: 60, durationBeats: 4 }] },
        { name: 'Keys', notes: [{ beat: 1, midi: 60, durationBeats: 1 }] },
      ],
    }),
  );
  const c4 = r.notes?.filter((x) => x.midi === 60) ?? [];
  expect(c4).toHaveLength(2);
  expect(c4[0].time + c4[0].duration).toBeLessThanOrEqual(c4[1].time + 1e-9);
});

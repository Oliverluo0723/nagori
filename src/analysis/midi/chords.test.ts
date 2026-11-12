import { Midi } from '@tonejs/midi';
import { expect, test } from 'vitest';
import { makeMidi } from '../../../test/fixtures/midi';
import { buildTempoMap } from '../tempo';
import { extractChords } from './chords';

const tri = (beat: number, notes: number[], len = 4) =>
  notes.map((midi) => ({ beat, midi, durationBeats: len }));

test('one chord event per run of equal names: Bm then G', () => {
  const midi = new Midi(
    makeMidi({
      bpm: 120,
      tracks: [{ name: 'Pad', notes: [...tri(0, [59, 62, 66]), ...tri(4, [55, 59, 62])] }],
    }),
  );
  const chords = extractChords(midi.tracks, buildTempoMap(midi.header), 4);
  expect(chords).toHaveLength(2);
  expect(chords[0]).toMatchObject({
    time: 0,
    duration: 2,
    root: 11,
    name: 'Bm',
    notes: [2, 6, 11],
  });
  expect(chords[1]).toMatchObject({ time: 2, duration: 2, root: 7, notes: [2, 7, 11] });
  expect(['G', 'GM']).toContain(chords[1].name);
});

test('arpeggio: single notes per beat become single-note events (pinned, review focus 5)', () => {
  const midi = new Midi(
    makeMidi({
      bpm: 120,
      tracks: [
        {
          name: 'Keys',
          notes: [
            { beat: 0, midi: 62, durationBeats: 1 },
            { beat: 1, midi: 66, durationBeats: 1 },
            { beat: 2, midi: 69, durationBeats: 1 },
          ],
        },
      ],
    }),
  );
  const chords = extractChords(midi.tracks, buildTempoMap(midi.header), 1.5);
  expect(chords.map((c) => c.name)).toEqual(['D', 'F♯', 'A']);
  expect(chords.map((c) => c.root)).toEqual([2, 6, 9]);
});

test('no chord-role tracks gives an empty list', () => {
  // extractChords 只收和弦角色的軌；呼叫端（analyzeMidi）負責篩選
  const midi = new Midi(makeMidi({ tracks: [{ name: 'Drums', notes: [{ beat: 0, midi: 36 }] }] }));
  expect(extractChords([], buildTempoMap(midi.header), 2)).toEqual([]);
});

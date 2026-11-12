import { Midi } from '@tonejs/midi';
import { expect, test } from 'vitest';
import { makeMidi } from '../../../test/fixtures/midi';
import { extractDrumHits } from './drums';

test('GM pitches become kick/snare/hat with normalized velocity, others dropped', () => {
  const midi = new Midi(
    makeMidi({
      bpm: 120,
      tracks: [
        {
          name: 'Drums',
          notes: [
            { beat: 0, midi: 36, velocity: 1 },
            { beat: 1, midi: 38, velocity: 0.5 },
            { beat: 1.5, midi: 42, velocity: 0.8 },
            { beat: 2, midi: 49, velocity: 1 },
          ],
        },
      ],
    }),
  );
  const hits = extractDrumHits(midi.tracks[0]);
  // velocity 經過 MIDI 的 7 位元量化（0.5 → 63/127），所以用 2 位小數比
  expect(hits.map((h) => [h.time, h.kind])).toEqual([
    [0, 'kick'],
    [0.5, 'snare'],
    [0.75, 'hat'],
  ]);
  expect(hits.map((h) => h.velocity)[0]).toBe(1);
  expect(hits.map((h) => h.velocity)[1]).toBeCloseTo(0.5, 2);
  expect(hits.map((h) => h.velocity)[2]).toBeCloseTo(0.8, 2);
});

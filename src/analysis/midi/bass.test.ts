import { Midi } from '@tonejs/midi';
import { expect, test } from 'vitest';
import { makeMidi } from '../../../test/fixtures/midi';
import { extractBass } from './bass';

test('bass notes keep midi, time, duration and pitch bends in semitones', () => {
  const midi = new Midi(
    makeMidi({
      bpm: 120,
      tracks: [
        {
          name: 'Bass',
          notes: [
            { beat: 0, midi: 26, durationBeats: 1 },
            { beat: 1, midi: 30, durationBeats: 1, bends: [{ beat: 1.5, value: 0.5 }] },
          ],
        },
      ],
    }),
  );
  const bass = extractBass(midi.tracks[0]);
  expect(bass).toHaveLength(2);
  expect(bass[0]).toMatchObject({ time: 0, duration: 0.5, midi: 26, bends: [] });
  expect(bass[1].midi).toBe(30);
  expect(bass[1].bends).toHaveLength(1);
  expect(bass[1].bends[0].time).toBeCloseTo(0.75);
  expect(bass[1].bends[0].semitones).toBeCloseTo(1, 1);
});

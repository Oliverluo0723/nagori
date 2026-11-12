import { Midi } from '@tonejs/midi';
import { expect, test } from 'vitest';
import { makeMidi } from '../../test/fixtures/midi';
import { bpmAt, buildTempoMap, positionAt, timeOfBar } from './tempo';

test('120 bpm 4/4: t=2s is bar 2 beat 1', () => {
  const midi = new Midi(makeMidi({ bpm: 120, tracks: [] }));
  const map = buildTempoMap(midi.header);
  expect(positionAt(map, 2)).toMatchObject({ bar: 2, beat: 1, bpm: 120 });
  expect(positionAt(map, 2.25).beatPhase).toBeCloseTo(0.5);
  expect(timeOfBar(map, 3)).toBeCloseTo(4);
});

test('tempo change at beat 8 from 120 to 60 matches ticksToSeconds', () => {
  const midi = new Midi(makeMidi({ bpm: 120, tempoChanges: [{ beat: 8, bpm: 60 }], tracks: [] }));
  const map = buildTempoMap(midi.header);
  const ppq = midi.header.ppq;
  expect(timeOfBar(map, 4)).toBeCloseTo(midi.header.ticksToSeconds(12 * ppq));
  expect(positionAt(map, timeOfBar(map, 4) + 0.5)).toMatchObject({ bar: 4, beat: 1 });
  expect(bpmAt(map, 10)).toBe(60);
});

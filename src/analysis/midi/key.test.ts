import { Midi } from '@tonejs/midi';
import { expect, test } from 'vitest';
import { makeMidi } from '../../../test/fixtures/midi';
import type { ChordEvent } from '../types';
import { detectKey } from './key';

const chord = (root: number, name: string): ChordEvent => ({
  time: 0,
  duration: 1,
  root,
  name,
  notes: [root],
});

test('key signature in the header wins', () => {
  const midi = new Midi(makeMidi({ keySignature: { key: 'D', scale: 'major' }, tracks: [] }));
  expect(detectKey(midi.header, [chord(7, 'G')])).toEqual({
    tonic: 2,
    mode: 'major',
    name: 'D major',
  });
});

test('without a key signature, the most common chord root decides; mode from its chords', () => {
  const midi = new Midi(makeMidi({ tracks: [] }));
  const chords = [chord(2, 'D'), chord(2, 'DM'), chord(7, 'G'), chord(2, 'D')];
  expect(detectKey(midi.header, chords)).toEqual({ tonic: 2, mode: 'major', name: 'D major' });
  const minor = [chord(11, 'Bm'), chord(11, 'Bm'), chord(7, 'G')];
  expect(detectKey(midi.header, minor)).toEqual({ tonic: 11, mode: 'minor', name: 'B minor' });
});

test('nothing to go on gives undefined', () => {
  const midi = new Midi(makeMidi({ tracks: [] }));
  expect(detectKey(midi.header, [])).toBeUndefined();
});

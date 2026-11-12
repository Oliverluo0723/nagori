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

test('a real B-minor file (2 sharps, minor flag) parses as D/minor in tonejs and must become B minor', () => {
  // tonejs 只依升降號數給「關係大調」的名稱：sf=2, mi=1 → { key: 'D', scale: 'minor' }
  const midi = new Midi(makeMidi({ tracks: [] }));
  midi.header.keySignatures.push({ ticks: 0, key: 'D', scale: 'minor' });
  expect(detectKey(midi.header, [])).toEqual({ tonic: 11, mode: 'minor', name: 'B minor' });
});

test('fixture writes minor keys with the relative major sharps so they round-trip', () => {
  const midi = new Midi(makeMidi({ keySignature: { key: 'B', scale: 'minor' }, tracks: [] }));
  expect(midi.header.keySignatures[0]).toMatchObject({ key: 'D', scale: 'minor' });
  const flat = new Midi(makeMidi({ keySignature: { key: 'D', scale: 'minor' }, tracks: [] }));
  expect(flat.header.keySignatures[0]).toMatchObject({ key: 'F', scale: 'minor' });
  expect(detectKey(flat.header, [])).toEqual({ tonic: 2, mode: 'minor', name: 'D minor' });
});

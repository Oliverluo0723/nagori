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

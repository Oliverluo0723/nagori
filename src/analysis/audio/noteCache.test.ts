import { expect, test } from 'vitest';
import { MemoryNoteStore, noteKey, packNotes, unpackNotes } from './noteCache';

const notes = [
  { time: 0.25, duration: 0.5, midi: 62, velocity: 0.7 },
  { time: 1, duration: 0.125, midi: 38, velocity: 1 },
];

test('pack / unpack round-trips notes', () => {
  expect(unpackNotes(packNotes(notes))).toEqual(notes);
});

test('unpack treats garbage as a miss', () => {
  expect(unpackNotes('not json')).toBeUndefined();
  expect(unpackNotes(JSON.stringify({ v: 1, flat: [1, 2, 3] }))).toBeUndefined();
  expect(unpackNotes(JSON.stringify({ v: 2, flat: [] }))).toBeUndefined();
  expect(unpackNotes(JSON.stringify({ v: 1, flat: [1, 2, 'x', 4] }))).toBeUndefined();
});

test('MemoryNoteStore: miss, then hit with equal notes', async () => {
  const store = new MemoryNoteStore();
  expect(await store.get('k')).toBeUndefined();
  await store.put('k', notes);
  expect(await store.get('k')).toEqual(notes);
});

test('noteKey depends on the samples and on the thresholds', async () => {
  const a = Float32Array.from([0, 0.5, -0.5]);
  const k = await noteKey(a, 'o0.5');
  expect(k).toMatch(/^notes-v1-[0-9a-f]{64}-o0\.5$/);
  expect(await noteKey(Float32Array.from([0, 0.5, -0.5]), 'o0.5')).toBe(k);
  expect(await noteKey(Float32Array.from([0, 0.5, -0.4]), 'o0.5')).not.toBe(k);
  expect(await noteKey(a, 'o0.6')).not.toBe(k);
});

test('noteKey hashes only the view, not the whole buffer', async () => {
  const big = Float32Array.from([9, 1, 2, 9]);
  expect(await noteKey(big.subarray(1, 3), 'x')).toBe(
    await noteKey(Float32Array.from([1, 2]), 'x'),
  );
});

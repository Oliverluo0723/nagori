import { expect, test } from 'vitest';
import { synthBeat } from '../../../test/fixtures/audio';
import { chordFromName, detectChords, smoothChords } from './chords';

const SR = 44100;
const beatsEvery = (step: number, until: number) => {
  const out: number[] = [];
  for (let t = 0; t <= until; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
};

test('chordFromName: F#m, Bb, D, and N (no chord)', () => {
  expect(chordFromName('F#m')).toEqual({ root: 6, notes: [6, 9, 1], display: 'F♯m' });
  expect(chordFromName('Bb')).toEqual({ root: 10, notes: [10, 2, 5], display: 'B♭' });
  expect(chordFromName('D')).toEqual({ root: 2, notes: [2, 6, 9], display: 'D' });
  expect(chordFromName('N')).toBeNull();
});

test('smoothChords: a 0.1 s blip merges into its neighbour and boundaries snap to beats (review focus 4)', () => {
  const beats = beatsEvery(0.5, 4);
  const raw = [
    { name: 'D', start: 0, end: 2.0 },
    { name: 'Bb', start: 2.0, end: 2.1 },
    { name: 'D', start: 2.1, end: 4 },
  ];
  const out = smoothChords(raw, beats);
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ name: 'D', time: 0, duration: 4 });
  // 真的換和弦，邊界在 2.03：吸到 2.0
  const two = smoothChords(
    [
      { name: 'D', start: 0, end: 2.03 },
      { name: 'G', start: 2.03, end: 4 },
    ],
    beats,
  );
  expect(two.map((c) => [c.name, c.time, c.duration])).toEqual([
    ['D', 0, 2],
    ['G', 2, 2],
  ]);
});

test('synthetic beat: Bm G D A repeating, boundaries near bar lines, key D major', async () => {
  const pcm = synthBeat({ bars: 8 });
  const beats = beatsEvery(0.5, 16);
  const { chords, key } = await detectChords(pcm, beats);
  expect(chords.map((c) => c.name)).toEqual(['Bm', 'G', 'D', 'A', 'Bm', 'G', 'D', 'A']);
  for (const c of chords)
    expect(Math.abs(c.time - Math.round(c.time / 2) * 2)).toBeLessThanOrEqual(0.1);
  expect(chords[0].notes).toEqual([11, 2, 6]);
  expect(key).toEqual({ tonic: 2, mode: 'major', name: 'D major' });
}, 60000);

test('silence gives no chords and no key (review focus 3)', async () => {
  const { chords, key } = await detectChords(new Float32Array(SR * 4), beatsEvery(0.5, 4));
  expect(chords).toEqual([]);
  expect(key).toBeUndefined();
}, 60000);

test('smoothChords survives an event that snaps to zero length (regression: index drift)', () => {
  const beats = beatsEvery(0.5, 4);
  const out = smoothChords(
    [
      { name: 'D', start: 0, end: 1.0 },
      { name: 'G', start: 1.0, end: 1.2 }, // 短於半拍：併入 D
      { name: 'A', start: 1.2, end: 2.0 },
      { name: 'Bm', start: 2.0, end: 4.0 },
    ],
    beats,
  );
  expect(out.map((c) => c.name)).toEqual(['D', 'A', 'Bm']);
  for (let i = 1; i < out.length; i++)
    expect(out[i].time).toBeCloseTo(out[i - 1].time + out[i - 1].duration);
});

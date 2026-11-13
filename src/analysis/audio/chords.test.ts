import { expect, test } from 'vitest';
import { synthBeat } from '../../../test/fixtures/audio';
import {
  bassPcPerBeat,
  chordName,
  chordsFromChroma,
  chordsFromNotes,
  chromaPerBeat,
  detectChords,
  lowestPcPerBeat,
} from './chords';

const SR = 44100;
const beatsEvery = (step: number, until: number) => {
  const out: number[] = [];
  for (let t = 0; t <= until; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
};
const chromaOf = (pcs: number[], weights?: number[]) => {
  const c = new Float32Array(12);
  pcs.forEach((pc, i) => {
    c[pc] = weights?.[i] ?? 1;
  });
  return c;
};

test('chordName: sharps are shown as ♯ and qualities as suffixes', () => {
  expect(chordName(6, 1)).toBe('F♯m');
  expect(chordName(9, 3)).toBe('Am7');
  expect(chordName(0, 4)).toBe('Cmaj7');
  expect(chordName(7, 2)).toBe('G7');
});

test('chordsFromChroma: clean triads give one event per bar, boundaries on the beats', () => {
  const beats = beatsEvery(0.5, 7.5);
  const bars = [
    [11, 2, 6],
    [7, 11, 2],
    [2, 6, 9],
    [9, 1, 4],
  ];
  const chroma = beats.map((_, i) => chromaOf(bars[Math.floor(i / 4)]));
  const out = chordsFromChroma(chroma, beats);
  expect(out.map((c) => [c.name, c.time, c.duration])).toEqual([
    ['Bm', 0, 2],
    ['G', 2, 2],
    ['D', 4, 2],
    ['A', 6, 2],
  ]);
  expect(out[0].notes).toEqual([11, 2, 6]);
});

test('chordsFromChroma: the bass decides Am7 vs C, and C/G stays C (inversion)', () => {
  const beats = beatsEvery(0.5, 1.5);
  const am7 = beats.map(() => chromaOf([9, 0, 4, 7]));
  expect(chordsFromChroma(am7, beats, [9, 9, 9, 9])[0].name).toBe('Am7');
  expect(chordsFromChroma(am7, beats, [0, 0, 0, 0])[0].name).toBe('C');
  const cOverG = beats.map(() => chromaOf([0, 4, 7]));
  expect(chordsFromChroma(cOverG, beats, [7, 7, 7, 7])[0].name).toBe('C');
});

test('chordsFromChroma: a one-beat blip inside a bar is smoothed away, silence gives no chord', () => {
  const beats = beatsEvery(0.5, 3.5);
  const chroma = beats.map((_, i) =>
    i === 3 ? chromaOf([2, 6, 9, 10, 5], [0.7, 0.5, 0.5, 0.8, 0.6]) : chromaOf([2, 6, 9]),
  );
  const out = chordsFromChroma(chroma, beats);
  expect(out.map((c) => c.name)).toEqual(['D']);
  expect(out[0].duration).toBeCloseTo(4);
  // 第 5–8 拍靜音：事件停在 2 s
  const half = beats.map((_, i) => (i < 4 ? chromaOf([2, 6, 9]) : new Float32Array(12)));
  const two = chordsFromChroma(half, beats);
  expect(two).toHaveLength(1);
  expect(two[0].duration).toBeCloseTo(2);
  expect(chordsFromChroma([], [])).toEqual([]);
});

test('bassPcPerBeat picks the bass note that overlaps the beat most; chromaPerBeat averages frames by beat', () => {
  const beats = [0, 0.5, 1];
  const bass = [
    { time: 0, duration: 0.4, midi: 45, bends: [] },
    { time: 0.4, duration: 0.2, midi: 40, bends: [] },
    { time: 0.6, duration: 0.4, midi: 48, bends: [] },
  ];
  expect(bassPcPerBeat(bass, beats)).toEqual([9, 0, -1]);
  const frames = [chromaOf([0]), chromaOf([4]), chromaOf([7]), chromaOf([7])];
  const chroma = chromaPerBeat(frames, [0.1, 0.3, 0.6, 0.8], beats);
  expect(Array.from(chroma[0])).toEqual(Array.from(chromaOf([0, 4], [0.5, 0.5])));
  expect(chroma[1][7]).toBe(1);
  expect(Array.from(chroma[2])).toEqual(new Array(12).fill(0));
});

test('synthetic beat: Bm G D A repeating, boundaries on bar lines, key D major', async () => {
  const pcm = synthBeat({ bars: 8 });
  const beats = beatsEvery(0.5, 16);
  const { chords, key } = await detectChords(pcm, beats);
  expect(chords.map((c) => c.name)).toEqual(['Bm', 'G', 'D', 'A', 'Bm', 'G', 'D', 'A']);
  for (const c of chords)
    expect(Math.abs(c.time - Math.round(c.time / 2) * 2)).toBeLessThanOrEqual(0.1);
  expect(chords[0].notes).toEqual([11, 2, 6]);
  expect(key).toEqual({ tonic: 2, mode: 'major', name: 'D major' });
}, 60000);

test('silence gives no chords and no key', async () => {
  const { chords, key } = await detectChords(new Float32Array(SR * 4), beatsEvery(0.5, 4));
  expect(chords).toEqual([]);
  expect(key).toBeUndefined();
}, 60000);

test('chordsFromNotes: Am7 with the bass on A, C when the bass sits on C; lowest note is the bass fallback', () => {
  const beats = beatsEvery(0.5, 1.5);
  const note = (midi: number, time = 0, duration = 2, velocity = 0.7) => ({
    time,
    duration,
    midi,
    velocity,
  });
  const pad = [note(57), note(60), note(64), note(67)];
  const bassA = [{ time: 0, duration: 2, midi: 45, bends: [] }];
  const bassC = [{ time: 0, duration: 2, midi: 48, bends: [] }];
  expect(chordsFromNotes(pad, beats, bassA).map((c) => [c.name, c.time, c.duration])).toEqual([
    ['Am7', 0, 2],
  ]);
  expect(chordsFromNotes(pad, beats, bassC)[0].name).toBe('C');
  // 沒有 bass 讀數：最低的音（A2）當 bass
  expect(chordsFromNotes([...pad, note(45)], beats)[0].name).toBe('Am7');
  expect(lowestPcPerBeat([note(45, 0, 0.4), note(72)], [0, 0.5])).toEqual([9, -1]);
  // 沒有拍點：每 0.5 s 一拍
  expect(chordsFromNotes(pad, [], bassA)[0]).toMatchObject({ name: 'Am7', time: 0, duration: 2 });
  expect(chordsFromNotes([], beats)).toEqual([]);
});

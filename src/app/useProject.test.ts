import { expect, test } from 'vitest';
import { makeMidi } from '../../test/fixtures/midi';
import { MemoryStemStore, stemKey } from '../analysis/stems/cache';
import type { Stems } from '../analysis/stems/types';
import type { Readings } from '../analysis/types';
import { type AnalyzeFn, type AnalyzeInput, analyzeInline } from '../analysis/workerClient';
import { loadDroppedFiles } from './useProject';

const blob = (u: Uint8Array) =>
  new Blob([u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer]);

const deps = { getDuration: async () => 30, createUrl: () => 'blob:x' };

const fakeReadings = (pcm: Float32Array, sampleRate: number): Readings => ({
  duration: pcm.length / sampleRate,
  tempo: { ppq: 480, tempos: [{ ticks: 0, bpm: 100 }], timeSignatures: [], offset: 0.1 },
  drums: [{ time: 0, kind: 'kick' as const, velocity: 1 }],
  roles: [],
  chords: [],
  bass: [],
  source: {
    tempo: 'audio' as const,
    drums: 'audio' as const,
    chords: 'none' as const,
    bass: 'none' as const,
    key: 'none' as const,
  },
});

const fakeAudio: AnalyzeFn = async (input) => fakeReadings(input.pcm, input.sampleRate);

const fakeDecode = async () => ({ pcm: new Float32Array(44100), sampleRate: 44100 });

function fakeStems(n = 8): Stems {
  const z = new Float32Array(n);
  return { sampleRate: 44100, drums: z, bass: z, other: z, vocals: z };
}

test('mp3 without mid → analysed from audio', async () => {
  const r = await loadDroppedFiles([new File([''], 'song.mp3')], {
    ...deps,
    decode: fakeDecode,
    analyze: fakeAudio,
  });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.readings.source?.drums).toBe('audio');
});

test('mp3 without mid and without a decoder → parse-failed', async () => {
  const r = await loadDroppedFiles([new File([''], 'song.mp3')], deps);
  expect(r).toEqual({ ok: false, reason: 'parse-failed' });
});

test('audio analysis finds no beat → no-beat', async () => {
  const r = await loadDroppedFiles([new File([''], 'song.mp3')], {
    ...deps,
    decode: fakeDecode,
    analyze: async (input) => ({
      ...fakeReadings(input.pcm, input.sampleRate),
      source: { tempo: 'none', drums: 'none', chords: 'none', bass: 'none', key: 'none' },
    }),
  });
  expect(r).toEqual({ ok: false, reason: 'no-beat' });
});

test('mid without audio → need-audio', async () => {
  const r = await loadDroppedFiles([new File([blob(makeMidi({ tracks: [] }))], 'song.mid')], deps);
  expect(r).toEqual({ ok: false, reason: 'need-audio' });
});

test('mp3 + mid → readings with duration from audio', async () => {
  const r = await loadDroppedFiles(
    [new File([''], 'song.mp3'), new File([blob(makeMidi({ tracks: [] }))], 'song.mid')],
    deps,
  );
  expect(r).toMatchObject({ ok: true, name: 'song', audioUrl: 'blob:x' });
  if (r.ok) expect(r.readings.duration).toBe(30);
});

test('corrupt mid → parse-failed', async () => {
  const r = await loadDroppedFiles(
    [new File([''], 'song.wav'), new File([blob(new Uint8Array([1, 2, 3]))], 'song.mid')],
    deps,
  );
  expect(r).toEqual({ ok: false, reason: 'parse-failed' });
});

test('prefers the .mid whose basename matches the audio', async () => {
  const r = await loadDroppedFiles(
    [
      new File([''], 'a.mp3'),
      new File([blob(makeMidi({ bpm: 90, tracks: [] }))], 'b.mid'),
      new File([blob(makeMidi({ bpm: 140, tracks: [] }))], 'a.mid'),
    ],
    deps,
  );
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.readings.tempo.tempos[0].bpm).toBeCloseTo(140, 2);
});

test('one audio + one .mid with different names still pairs', async () => {
  const r = await loadDroppedFiles(
    [new File([''], 'a.mp3'), new File([blob(makeMidi({ tracks: [] }))], 'b.mid')],
    deps,
  );
  expect(r.ok).toBe(true);
});

test('several .mid but none matching the audio name → treated as no MIDI (parse-failed without decoder)', async () => {
  const r = await loadDroppedFiles(
    [
      new File([''], 'a.mp3'),
      new File([blob(makeMidi({ tracks: [] }))], 'b.mid'),
      new File([blob(makeMidi({ tracks: [] }))], 'c.mid'),
    ],
    deps,
  );
  expect(r).toEqual({ ok: false, reason: 'parse-failed' });
});

test('with a decoder, readings carry a spectrum (1 s → 50 frames)', async () => {
  const sr = 44100;
  const pcm = new Float32Array(sr);
  for (let i = 0; i < sr; i++) pcm[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.5;
  const r = await loadDroppedFiles(
    [new File([''], 'song.mp3'), new File([blob(makeMidi({ tracks: [] }))], 'song.mid')],
    // 真的跑 analyzeAudio（要拿 spectrum），但 Node 裡不分軌
    {
      ...deps,
      decode: async () => ({ pcm, sampleRate: sr }),
      separate: false,
      stemStore: new MemoryStemStore(),
    },
  );
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.readings.spectrum?.frameCount).toBe(50);
});

test('without a decoder, spectrum stays undefined', async () => {
  const r = await loadDroppedFiles(
    [new File([''], 'song.mp3'), new File([blob(makeMidi({ tracks: [] }))], 'song.mid')],
    deps,
  );
  if (r.ok) expect(r.readings.spectrum).toBeUndefined();
});

test('a failing decoder still loads the song, just without a spectrum (reviewer finding)', async () => {
  const r = await loadDroppedFiles(
    [new File([''], 'song.mp3'), new File([blob(makeMidi({ tracks: [] }))], 'song.mid')],
    {
      ...deps,
      decode: async () => {
        throw new Error('cannot decode');
      },
    },
  );
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.readings.spectrum).toBeUndefined();
});

// ---- 分軌（里程碑 5） ----

test('needsAudio → analyze gets separate=true and stems are cached under the file hash', async () => {
  const store = new MemoryStemStore();
  const inputs: AnalyzeInput[] = [];
  const stems = fakeStems();
  const analyze: AnalyzeFn = async (input, _p, onStems) => {
    inputs.push(input);
    onStems?.(stems);
    return fakeReadings(input.pcm, input.sampleRate);
  };
  const r = await loadDroppedFiles([new File(['abc'], 'song.mp3')], {
    ...deps,
    decode: fakeDecode,
    analyze,
    stemStore: store,
  });
  expect(r.ok).toBe(true);
  expect(inputs).toHaveLength(1);
  expect(inputs[0].separate).toBe(true);
  expect(inputs[0].stems).toBeUndefined();
  // 沒給 left/right 時拿 pcm 當左右
  expect(inputs[0].left).toBe(inputs[0].pcm);
  expect(inputs[0].right).toBe(inputs[0].pcm);
  const key = await stemKey(new TextEncoder().encode('abc').buffer as ArrayBuffer);
  expect(await store.get(key)).toBe(stems);
});

test('cache hit skips separation (review focus 2)', async () => {
  const store = new MemoryStemStore();
  const stems = fakeStems();
  await store.put(await stemKey(new TextEncoder().encode('abc').buffer as ArrayBuffer), stems);
  const inputs: AnalyzeInput[] = [];
  const analyze: AnalyzeFn = async (input) => {
    inputs.push(input);
    return fakeReadings(input.pcm, input.sampleRate);
  };
  await loadDroppedFiles([new File(['abc'], 'song.mp3')], {
    ...deps,
    decode: fakeDecode,
    analyze,
    stemStore: store,
  });
  expect(inputs[0]).toMatchObject({ separate: false, stems });
});

test('mp3 + full mid → no audio analysis, so no separation requested', async () => {
  const inputs: AnalyzeInput[] = [];
  const analyze: AnalyzeFn = async (input) => {
    inputs.push(input);
    return fakeReadings(input.pcm, input.sampleRate);
  };
  const midi = makeMidi({
    tracks: [
      { name: 'Drums', notes: [{ beat: 0, midi: 36 }] },
      { name: 'Bass', notes: [{ beat: 0, midi: 36, durationBeats: 2 }] },
      {
        name: 'Chords',
        notes: [
          { beat: 0, midi: 60, durationBeats: 4 },
          { beat: 0, midi: 64, durationBeats: 4 },
          { beat: 0, midi: 67, durationBeats: 4 },
        ],
      },
    ],
  });
  const r = await loadDroppedFiles(
    [new File([''], 'song.mp3'), new File([blob(midi)], 'song.mid')],
    { ...deps, decode: fakeDecode, analyze, stemStore: new MemoryStemStore() },
  );
  expect(r.ok).toBe(true);
  expect(inputs).toHaveLength(0);
});

test('deps.separate=false → analyze gets separate=false', async () => {
  const inputs: AnalyzeInput[] = [];
  const analyze: AnalyzeFn = async (input) => {
    inputs.push(input);
    return fakeReadings(input.pcm, input.sampleRate);
  };
  await loadDroppedFiles([new File(['abc'], 'song.mp3')], {
    ...deps,
    decode: fakeDecode,
    analyze,
    separate: false,
    stemStore: new MemoryStemStore(),
  });
  expect(inputs[0].separate).toBe(false);
});

test('analyzeInline: separation failure falls back to mix analysis', async () => {
  const pcm = new Float32Array(44100);
  const r = await analyzeInline(
    { pcm, sampleRate: 44100, left: pcm, right: pcm, separate: true },
    () => {},
    undefined,
    async () => {
      throw new Error('404');
    },
  );
  expect(r.source?.bass).not.toBe('stem');
  expect(r.source?.drums).not.toBe('stem');
});

test('analyzeInline: separation success → stems reported and sources are stem', async () => {
  const pcm = new Float32Array(44100 * 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin((2 * Math.PI * 55 * i) / 44100) * 0.5;
  const stems: Stems = { sampleRate: 44100, drums: pcm, bass: pcm, other: pcm, vocals: pcm };
  const stages: string[] = [];
  let got: Stems | undefined;
  const r = await analyzeInline(
    { pcm, sampleRate: 44100, left: pcm, right: pcm, separate: true },
    (stage) => {
      if (stages[stages.length - 1] !== stage) stages.push(stage);
    },
    (s) => {
      got = s;
    },
    async (_l, _r, opts) => {
      opts?.onProgress?.(0.5);
      return stems;
    },
  );
  expect(got).toBe(stems);
  expect(stages[0]).toBe('separate');
  expect(r.source?.bass).toBe('stem');
}, 60000);

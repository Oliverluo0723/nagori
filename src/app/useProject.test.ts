import { expect, test } from 'vitest';
import { makeMidi } from '../../test/fixtures/midi';
import { loadDroppedFiles } from './useProject';

const blob = (u: Uint8Array) =>
  new Blob([u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer]);

const deps = { getDuration: async () => 30, createUrl: () => 'blob:x' };

const fakeAudio = async (pcm: Float32Array, sampleRate: number) => ({
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

test('mp3 without mid → analysed from audio', async () => {
  const r = await loadDroppedFiles([new File([''], 'song.mp3')], {
    ...deps,
    decode: async () => ({ pcm: new Float32Array(44100), sampleRate: 44100 }),
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
    decode: async () => ({ pcm: new Float32Array(44100), sampleRate: 44100 }),
    analyze: async (pcm, sr) => ({
      ...(await fakeAudio(pcm, sr)),
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
    { ...deps, decode: async () => ({ pcm, sampleRate: sr }) },
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

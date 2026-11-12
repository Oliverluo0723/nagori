import { expect, test } from 'vitest';
import { makeMidi } from '../../test/fixtures/midi';
import { loadDroppedFiles } from './useProject';

const blob = (u: Uint8Array) =>
  new Blob([u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer]);

const deps = { getDuration: async () => 30, createUrl: () => 'blob:x' };

test('mp3 without mid → need-midi', async () => {
  const r = await loadDroppedFiles([new File([''], 'song.mp3')], deps);
  expect(r).toEqual({ ok: false, reason: 'need-midi' });
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

test('several .mid but none matching the audio name → need-midi', async () => {
  const r = await loadDroppedFiles(
    [
      new File([''], 'a.mp3'),
      new File([blob(makeMidi({ tracks: [] }))], 'b.mid'),
      new File([blob(makeMidi({ tracks: [] }))], 'c.mid'),
    ],
    deps,
  );
  expect(r).toEqual({ ok: false, reason: 'need-midi' });
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

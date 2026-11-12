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

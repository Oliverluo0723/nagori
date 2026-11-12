import { expect, test } from 'vitest';
import { MemoryNoteStore } from './audio/noteCache';
import type { TranscribeFn } from './audio/transcribe';
import type { Stems } from './stems/types';
import type { NoteEvent } from './types';
import { runAnalysis, transcribeStage } from './workerClient';

const NOTES: NoteEvent[] = [{ time: 0.5, duration: 0.25, midi: 50, velocity: 0.6 }];

/** 假的轉譜器：記下餵進來的音訊，回固定的音符 */
function fakeTranscriber() {
  const fed: Float32Array[] = [];
  const fn: TranscribeFn = async (pcm, _sr, opts) => {
    fed.push(pcm);
    opts?.onProgress?.(0.5);
    return NOTES;
  };
  return { fn, fed };
}

test('without stems the mix is transcribed and the result is cached', async () => {
  const pcm = Float32Array.from({ length: 4410 }, (_, i) => Math.sin(i / 10));
  const { fn, fed } = fakeTranscriber();
  const store = new MemoryNoteStore();
  const first = await transcribeStage(pcm, 44100, undefined, () => {}, { transcribe: fn, store });
  expect(first.notes).toEqual(NOTES);
  expect(fed[0]).toBe(pcm);
  const again = await transcribeStage(pcm, 44100, undefined, () => {}, { transcribe: fn, store });
  expect(again.notes).toEqual(NOTES);
  expect(fed).toHaveLength(1);
});

test('with stems bass + other are fed (no drums, no vocals)', async () => {
  const len = 100;
  const fill = (v: number) => new Float32Array(len).fill(v);
  const stems: Stems = {
    sampleRate: 44100,
    drums: fill(100),
    bass: fill(1),
    other: fill(2),
    vocals: fill(1000),
  };
  const { fn, fed } = fakeTranscriber();
  await transcribeStage(fill(0), 44100, stems, () => {}, { transcribe: fn });
  expect(Array.from(fed[0])).toEqual(Array(len).fill(3));
});

test('a failing transcriber gives empty notes and an error, not a rejection', async () => {
  const out = await transcribeStage(new Float32Array(10), 44100, undefined, () => {}, {
    transcribe: async () => {
      throw new Error('tfjs exploded');
    },
  });
  expect(out).toEqual({ notes: [], error: 'tfjs exploded' });
});

test('runAnalysis: notes stage runs after bass and fills notes + source', async () => {
  const pcm = new Float32Array(44100 * 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin((2 * Math.PI * 110 * i) / 44100) * 0.5;
  const stages: string[] = [];
  const { fn } = fakeTranscriber();
  const out = await runAnalysis(
    { pcm, sampleRate: 44100, left: pcm, right: pcm, separate: false },
    (stage) => {
      if (stages[stages.length - 1] !== stage) stages.push(stage);
    },
    undefined,
    undefined,
    { transcribe: fn, store: new MemoryNoteStore() },
  );
  expect(stages.slice(-2)).toEqual(['bass', 'notes']);
  expect(out.readings.notes).toEqual(NOTES);
  expect(out.readings.source?.notes).toBe('audio');
  expect(out.notesError).toBeUndefined();
}, 60000);

test('runAnalysis in Node without a model: no notes, source none, analysis still succeeds', async () => {
  const pcm = new Float32Array(44100);
  const out = await runAnalysis(
    { pcm, sampleRate: 44100, left: pcm, right: pcm, separate: false },
    () => {},
  );
  expect(out.readings.notes).toEqual([]);
  expect(out.readings.source?.notes).toBe('none');
  expect(out.notesError).toMatch(/^notes model missing/);
}, 60000);

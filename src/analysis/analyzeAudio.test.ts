import { expect, test } from 'vitest';
import { synthBeat } from '../../test/fixtures/audio';
import { analyzeAudio, type Stage } from './analyzeAudio';
import { bpmAt } from './tempo';

test('analyzeAudio fills tempo, drums, chords, bass, key and spectrum from audio alone', async () => {
  const stages: Stage[] = [];
  const r = await analyzeAudio(synthBeat({ bars: 8 }), 44100, (stage) => {
    if (stages[stages.length - 1] !== stage) stages.push(stage);
  });
  expect(bpmAt(r.tempo, 1)).toBeGreaterThan(119);
  expect(bpmAt(r.tempo, 1)).toBeLessThan(121);
  expect(r.drums.length).toBeGreaterThan(50);
  expect(r.chords?.[0]?.name).toBe('Bm');
  expect(r.bass?.[0]?.midi).toBe(35);
  expect(r.key?.name).toBe('D major');
  expect(r.spectrum?.frameCount ?? 0).toBeGreaterThan(0);
  expect(r.rhythm?.candidates).toContain(120);
  expect(r.source).toEqual({
    tempo: 'audio',
    drums: 'audio',
    chords: 'audio',
    bass: 'audio',
    key: 'audio',
  });
  expect(stages).toEqual(['spectrum', 'rhythm', 'drums', 'chords', 'bass']);
  expect(r.duration).toBeCloseTo(17, 1);
}, 60000);

test('silence yields empty readings with source none and no crash (review focus 3)', async () => {
  const r = await analyzeAudio(new Float32Array(44100 * 4), 44100);
  expect(r.drums).toEqual([]);
  expect(r.chords).toEqual([]);
  expect(r.bass).toEqual([]);
  expect(r.key).toBeUndefined();
  expect(r.source?.tempo).toBe('none');
  expect(bpmAt(r.tempo, 0)).toBe(120); // 沒有節拍時的預設拍格
}, 60000);

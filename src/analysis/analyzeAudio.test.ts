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
  expect(stages).toEqual(['spectrum', 'rhythm', 'drums', 'bass', 'chords']);
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

test('with stems: drums come from the drum stem, bass from the bass stem, sources are stem', async () => {
  const mix = synthBeat({ bars: 4 });
  const stems = {
    sampleRate: 44100 as const,
    drums: synthBeat({ bars: 4, bassPartials: [], chords: [[]] }),
    bass: synthBeat({ bars: 4, drums: false, chords: [[]] }),
    other: synthBeat({ bars: 4, drums: false, bassPartials: [] }),
    vocals: new Float32Array(mix.length),
  };
  const r = await analyzeAudio(mix, 44100, () => {}, { stems });
  expect(r.source).toMatchObject({
    drums: 'stem',
    bass: 'stem',
    chords: 'stem',
    key: 'stem',
    tempo: 'audio',
  });
  expect(r.bass?.length).toBeGreaterThan(0);
  expect(r.bass?.every((n) => [35, 31, 38, 33].includes(n.midi))).toBe(true);
  expect(r.drums.filter((h) => h.kind === 'kick').length).toBeGreaterThanOrEqual(8);
}, 60000);

test('silent bass stem → no bass notes, source none (review focus 4)', async () => {
  const mix = synthBeat({ bars: 2 });
  const z = new Float32Array(mix.length);
  const r = await analyzeAudio(mix, 44100, () => {}, {
    stems: { sampleRate: 44100, drums: mix, bass: z, other: mix, vocals: z },
  });
  expect(r.bass).toEqual([]);
  expect(r.source?.bass).toBe('none');
}, 60000);

test('bass stem that is only leakage (−60 dB of a pitched line) → no bass notes, source none (reviewer)', async () => {
  // Demucs 不會輸出數位零：純鋼琴曲、清唱的 bass 軌是很小聲的殘留；偵測器本身是尺度不變的，要靠跟混音比
  const mix = synthBeat({ bars: 2 });
  const leak = synthBeat({ bars: 2, drums: false, chords: [[]] }).map((v) => v * 1e-3);
  const r = await analyzeAudio(mix, 44100, () => {}, {
    stems: { sampleRate: 44100, drums: mix, bass: leak, other: mix, vocals: leak },
  });
  expect(r.bass).toEqual([]);
  expect(r.source?.bass).toBe('none');
}, 60000);

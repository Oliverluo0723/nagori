import { expect, test } from 'vitest';
import { modelAvailable, type StemProcessor, separateStems, toMono } from './separate';

test('separateStems mixes each stem to mono and reports progress', async () => {
  const calls: number[] = [];
  const fake: StemProcessor = {
    loadModel: async () => {},
    separate: async (l, r) => {
      const st = (k: number) => ({ left: l.map((v) => v * k), right: r.map((v) => v * k) });
      return { drums: st(1), bass: st(2), other: st(3), vocals: st(4) };
    },
  };
  const s = await separateStems(new Float32Array([1, 1]), new Float32Array([3, 3]), {
    createProcessor: async (p) => {
      p(0.5);
      p(1);
      return fake;
    },
    onProgress: (f) => calls.push(f),
  });
  expect(Array.from(s.bass)).toEqual([4, 4]); // (1·2 + 3·2) / 2
  expect(Array.from(s.vocals)).toEqual([8, 8]);
  expect(s.sampleRate).toBe(44100);
  expect(calls).toEqual([0.5, 1]);
});

test('mono input is duplicated to both channels (review focus 3)', async () => {
  const seen: number[][] = [];
  const fake: StemProcessor = {
    loadModel: async () => {},
    separate: async (l, r) => {
      seen.push(Array.from(l), Array.from(r));
      const z = { left: l, right: r };
      return { drums: z, bass: z, other: z, vocals: z };
    },
  };
  const mono = new Float32Array([5]);
  await separateStems(mono, mono, { createProcessor: async () => fake });
  expect(seen).toEqual([[5], [5]]);
});

test('separateStems rejects channels of different length', async () => {
  await expect(
    separateStems(new Float32Array(2), new Float32Array(3), {
      createProcessor: async () => ({
        loadModel: async () => {},
        separate: async () => ({}) as never,
      }),
    }),
  ).rejects.toThrow(/length/);
});

test('toMono averages left and right', () => {
  expect(Array.from(toMono({ left: new Float32Array([2]), right: new Float32Array([4]) }))).toEqual(
    [3],
  );
});

test('modelAvailable is false on 404 and true on 200', async () => {
  expect(await modelAvailable('/x', async () => new Response(null, { status: 404 }))).toBe(false);
  expect(await modelAvailable('/x', async () => new Response(null, { status: 200 }))).toBe(true);
});

test('modelAvailable is false when fetch throws', async () => {
  expect(
    await modelAvailable('/x', async () => {
      throw new Error('offline');
    }),
  ).toBe(false);
});

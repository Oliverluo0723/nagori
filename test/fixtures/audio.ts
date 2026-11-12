import type { DrumHit } from '../../src/analysis/types';

export interface SynthOptions {
  bpm?: number;
  bars?: number;
  sampleRate?: number;
  drums?: boolean;
  /** 每小節的 bass midi，依小節輪替 */
  bass?: number[];
  /** 每小節的三和弦 midi，依小節輪替 */
  chords?: number[][];
  /** 開頭靜音秒數 */
  leadIn?: number;
}

const DEFAULTS = {
  bpm: 120,
  bars: 8,
  sampleRate: 44100,
  drums: true,
  bass: [35, 31, 38, 33],
  chords: [
    [59, 62, 66],
    [55, 59, 62],
    [62, 66, 69],
    [57, 61, 64],
  ],
  leadIn: 0,
};

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** 跟 samples/make-beat.mjs 同樣的鼓 pattern：kick 1、3 拍，snare 2、4 拍，hat 8 分，奇數小節第 4 拍後半多一顆 kick。 */
export function expectedHits(opts: SynthOptions = {}): DrumHit[] {
  const o = { ...DEFAULTS, ...opts };
  const beat = 60 / o.bpm;
  const hits: DrumHit[] = [];
  for (let bar = 0; bar < o.bars; bar++) {
    for (let b = 0; b < 4; b++) {
      const t = o.leadIn + (bar * 4 + b) * beat;
      if (b === 0 || b === 2) hits.push({ time: t, kind: 'kick', velocity: 1 });
      if (b === 1 || b === 3) hits.push({ time: t, kind: 'snare', velocity: 0.8 });
      hits.push({ time: t, kind: 'hat', velocity: 0.6 });
      hits.push({ time: t + beat / 2, kind: 'hat', velocity: 0.4 });
      if (bar % 2 === 1 && b === 3) hits.push({ time: t + beat / 2, kind: 'kick', velocity: 0.7 });
    }
  }
  return hits.sort((a, b) => a.time - b.time);
}

/** 合成一段 beat：鼓（正弦 kick、雜訊 snare/hat）、bass（基音 + 2 倍頻）、pad 三和弦。固定種子，結果可重現。 */
export function synthBeat(opts: SynthOptions = {}): Float32Array {
  const o = { ...DEFAULTS, ...opts };
  const SR = o.sampleRate;
  const beat = 60 / o.bpm;
  const seconds = o.leadIn + o.bars * 4 * beat + 1;
  const buf = new Float32Array(Math.round(seconds * SR));
  let seed = 1;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };
  const add = (start: number, len: number, fn: (t: number) => number) => {
    const s0 = Math.floor(start * SR);
    const n = Math.min(Math.floor(len * SR), buf.length - s0);
    for (let i = 0; i < n; i++) buf[s0 + i] += fn(i / SR);
  };

  if (o.drums) {
    for (const h of expectedHits(o)) {
      if (h.kind === 'kick') {
        add(h.time, 0.25, (t) => {
          const f = 50 + 100 * Math.exp(-t * 30);
          return Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 12) * 0.9 * h.velocity;
        });
      } else if (h.kind === 'snare') {
        add(
          h.time,
          0.18,
          (t) => (rnd() * 0.8 + Math.sin(2 * Math.PI * 180 * t) * 0.3) * Math.exp(-t * 20) * 0.7,
        );
      } else {
        add(h.time, 0.05, (t) => rnd() * Math.exp(-t * 80) * 0.35 * (h.velocity / 0.6));
      }
    }
  }

  for (let bar = 0; bar < o.bars; bar++) {
    const bassMidi = o.bass[bar % o.bass.length];
    for (let b = 0; b < 4; b++) {
      const t0 = o.leadIn + (bar * 4 + b) * beat;
      add(t0, beat, (t) => {
        const env = Math.min(1, t * 200) * Math.exp(-t * 2.5);
        return (
          (Math.sin(2 * Math.PI * hz(bassMidi) * t) * 0.8 +
            Math.sin(2 * Math.PI * hz(bassMidi) * 2 * t) * 0.25) *
          env *
          0.35
        );
      });
    }
    const chord = o.chords[bar % o.chords.length];
    const t0 = o.leadIn + bar * 4 * beat;
    for (const m of chord) {
      add(t0, 4 * beat, (t) => {
        const env = Math.min(1, t * 20) * Math.min(1, (4 * beat - t) * 10);
        return (
          (Math.sin(2 * Math.PI * hz(m) * t) + 0.3 * Math.sin(2 * Math.PI * hz(m) * 2 * t)) *
          env *
          0.08
        );
      });
    }
  }
  return buf;
}

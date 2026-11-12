import type { Spectrum } from '../types';
import { fft } from './fft';

export interface SpectrumOptions {
  fps?: number;
  bins?: number;
  fftSize?: number;
  minHz?: number;
  maxHz?: number;
}

const DEFAULTS = { fps: 50, bins: 64, fftSize: 2048, minHz: 30, maxHz: 16000 };

/** dB → 0..1：clamp((dB + 90) / 90, 0, 1)。0 dBFS 的滿幅正弦剛好 1，母帶很響的歌才不會整排頂到天花板。 */
function normalizeDb(mag: number, n: number): number {
  const db = 20 * Math.log10(mag / n + 1e-9);
  return Math.max(0, Math.min(1, (db + 90) / 90));
}

/** 整首歌離線算一次對數頻譜，每秒 fps 幀、每幀 bins 個 bin。 */
export function analyzeSpectrum(
  pcm: Float32Array,
  sampleRate: number,
  opts: SpectrumOptions = {},
): Spectrum {
  const { fps, bins, fftSize, minHz, maxHz } = { ...DEFAULTS, ...opts };
  const hop = sampleRate / fps;
  const frameCount = Math.max(1, Math.floor(pcm.length / hop));
  const frames = new Float32Array(frameCount * bins);
  const hann = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / fftSize);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const hzPerFft = sampleRate / fftSize;
  // 每個對數 bin 對應的 FFT bin 範圍
  const ranges: [number, number][] = [];
  for (let b = 0; b < bins; b++) {
    const lo = minHz * (maxHz / minHz) ** (b / bins);
    const hi = minHz * (maxHz / minHz) ** ((b + 1) / bins);
    const a = Math.max(1, Math.floor(lo / hzPerFft));
    const z = Math.min(fftSize / 2 - 1, Math.max(a, Math.ceil(hi / hzPerFft) - 1));
    ranges.push([a, z]);
  }
  const half = fftSize / 2;
  for (let f = 0; f < frameCount; f++) {
    const start = Math.round(f * hop) - half;
    for (let i = 0; i < fftSize; i++) {
      const idx = start + i;
      re[i] = (idx >= 0 && idx < pcm.length ? pcm[idx] : 0) * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    const row = f * bins;
    for (let b = 0; b < bins; b++) {
      const [a, z] = ranges[b];
      let m = 0;
      for (let k = a; k <= z; k++) {
        const v = Math.hypot(re[k], im[k]);
        if (v > m) m = v;
      }
      // Hann 窗的 coherent gain 是 0.5，補回來讓滿幅正弦接近 0 dB
      frames[row + b] = normalizeDb(m * 2, half);
    }
  }
  return { fps, bins, minHz, maxHz, frames, frameCount };
}

export function frameAt(s: Spectrum, t: number): number {
  const f = Math.floor(t * s.fps);
  return Math.max(0, Math.min(s.frameCount - 1, f));
}

export function binValue(s: Spectrum, frame: number, bin: number): number {
  const f = Math.max(0, Math.min(s.frameCount - 1, frame));
  return s.frames[f * s.bins + bin] ?? 0;
}

export function binHz(s: Spectrum, bin: number): number {
  return s.minHz * (s.maxHz / s.minHz) ** ((bin + 0.5) / s.bins);
}

/** loHz..hiHz 範圍內 bin 的平均，0..1。 */
export function bandEnergy(s: Spectrum, frame: number, loHz: number, hiHz: number): number {
  let sum = 0;
  let n = 0;
  for (let b = 0; b < s.bins; b++) {
    const hz = binHz(s, b);
    if (hz >= loHz && hz <= hiHz) {
      sum += binValue(s, frame, b);
      n++;
    }
  }
  return n ? sum / n : 0;
}

/** [frame − holdFrames, frame] 內的最大值；沒有內部狀態，所以同輸入同結果。 */
export function peakHold(s: Spectrum, frame: number, bin: number, holdFrames: number): number {
  let m = 0;
  const from = Math.max(0, frame - Math.max(0, Math.floor(holdFrames)));
  for (let k = from; k <= frame; k++) m = Math.max(m, binValue(s, k, bin));
  return m;
}

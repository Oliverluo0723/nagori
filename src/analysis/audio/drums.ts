import type { DrumHit, DrumKind, Spectrum } from '../types';
import { fft } from './fft';

/** 每個鼓件看一個頻帶的「線性幅度正向差分」（spectral flux）。線性域才分得開 kick 的正弦大跳與 snare 雜訊在低頻的小跳。 */
const BANDS: Record<DrumKind, [number, number]> = {
  kick: [30, 150],
  // 400 起算：避開 kick 掃頻起點（≤150 Hz）與 bass 前三個泛音（≤220 Hz）的漏入
  snare: [400, 3000],
  hat: [5000, 16000],
};

/** 門檻：flux 相對整首該頻帶最大 flux 的比例，以及相對局部平均（0.5 s）的倍數。 */
export const DRUM_THRESHOLDS: Record<DrumKind, { ofMax: number; overLocal: number }> = {
  kick: { ofMax: 0.4, overLocal: 2.0 },
  // snare 頻帶的最大值常是和弦樂器的起音，真 snare 只有它的 0.2–0.4，所以門檻低，再靠跨頻帶條件過濾
  snare: { ofMax: 0.15, overLocal: 1.8 },
  // snare 的雜訊也進高頻帶並決定最大值，輕的 hat 只有它的 0.2–0.4
  hat: { ofMax: 0.15, overLocal: 1.6 },
};

const FFT_SIZE = 2048;
const HOP = 256; // 44.1k → 5.8 ms
const MIN_GAP_SECONDS = 0.08;
const LOCAL_WINDOW_SECONDS = 0.5;
const MIN_VELOCITY = 0.3;
/** 線性幅度 flux 的絕對下限（pcm 在 ±1 時，一個 0.05 振幅的瞬態約 25；1 秒線性淡入每幀只有約 1.5） */
const ABSOLUTE_FLOOR = 20;
/** 同時刻 kick 正規化 flux 超過這個值時，snare 頻帶的跳升視為 kick 的漏入，除非 snare 自己更強 */
const SNARE_KICK_CEILING = 0.6;
/** snare 同時刻高頻帶正規化 flux 的下限（寬頻雜訊的證據） */
const SNARE_NEEDS_HIGH = 0.2;
/** 跨頻帶比較的視窗，單位幀（5.8 ms）：±6 ≈ 35 ms */
const CROSS_WINDOW = 6;
/** flux 峰值比瞬態實際位置早的量（秒），在合成 beat 上量到的 */
const ONSET_LAG = 0.03;

function windowMax(curve: Float32Array, index: number, radius: number): number {
  let m = 0;
  for (let i = Math.max(0, index - radius); i <= Math.min(curve.length - 1, index + radius); i++) {
    m = Math.max(m, curve[i]);
  }
  return m;
}

export interface BandFlux {
  fps: number;
  flux: Record<DrumKind, Float32Array>;
}

/** 每 5.8 ms 一幀，三個頻帶各一條 flux 曲線。 */
export function bandFlux(input: Float32Array, sampleRate: number): BandFlux {
  // 前面補一個 FFT 的靜音：歌一開始就有的 hit 才會是「從靜音跳上來」。時間在 detectDrums 裡扣回。
  const pcm = new Float32Array(input.length + FFT_SIZE);
  pcm.set(input, FFT_SIZE);
  const frames = Math.max(0, Math.floor((pcm.length - FFT_SIZE) / HOP) + 1);
  const hann = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const hzPerBin = sampleRate / FFT_SIZE;
  const kinds = Object.keys(BANDS) as DrumKind[];
  const ranges = kinds.map((k) => {
    const [lo, hi] = BANDS[k];
    return [
      Math.max(1, Math.floor(lo / hzPerBin)),
      Math.min(FFT_SIZE / 2 - 1, Math.ceil(hi / hzPerBin)),
    ];
  });
  const flux = {} as Record<DrumKind, Float32Array>;
  for (const k of kinds) flux[k] = new Float32Array(frames);
  let prev = new Float64Array(FFT_SIZE / 2);
  let cur = new Float64Array(FFT_SIZE / 2);
  for (let f = 0; f < frames; f++) {
    const start = f * HOP;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = pcm[start + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < FFT_SIZE / 2; b++) cur[b] = Math.hypot(re[b], im[b]);
    kinds.forEach((k, ki) => {
      const [a, z] = ranges[ki];
      let sum = 0;
      for (let b = a; b <= z; b++) {
        const d = cur[b] - prev[b];
        if (d > 0) sum += d;
      }
      flux[k][f] = sum;
    });
    [prev, cur] = [cur, prev];
  }
  return { fps: sampleRate / HOP, flux };
}

/** 局部最大、高於整首最大值的比例、高於局部平均的倍數，且與前一個峰相隔 ≥ 80 ms。 */
export function pickPeaks(
  curve: Float32Array,
  fps: number,
  th: { ofMax: number; overLocal: number },
): { index: number; strength: number }[] {
  const n = curve.length;
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, curve[i]);
  // 絕對下限：穩定的正弦或靜音只有數值抖動（~1e-9），不算 onset
  if (max < ABSOLUTE_FLOOR) return [];
  const half = Math.round((LOCAL_WINDOW_SECONDS * fps) / 2);
  const gap = Math.round(MIN_GAP_SECONDS * fps);
  const out: { index: number; strength: number }[] = [];
  let lastIndex = -Infinity;
  for (let i = 1; i < n - 1; i++) {
    const v = curve[i];
    if (v < curve[i - 1] || v < curve[i + 1]) continue;
    if (v < th.ofMax * max) continue;
    let sum = 0;
    let c = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(n - 1, i + half); k++) {
      sum += curve[k];
      c++;
    }
    if (v < th.overLocal * (sum / c)) continue;
    if (i - lastIndex < gap) {
      const last = out[out.length - 1];
      if (v > last.strength) {
        last.index = i;
        last.strength = v;
        lastIndex = i;
      }
      continue;
    }
    out.push({ index: i, strength: v });
    lastIndex = i;
  }
  return out;
}

/** 純函式：分頻帶 onset → kick / snare / hat。spectrum 參數保留給呼叫端一致的介面，這裡不用。 */
export async function detectDrums(
  pcm: Float32Array,
  _spectrum?: Spectrum,
  sampleRate = 44100,
): Promise<DrumHit[]> {
  if (pcm.length < FFT_SIZE) return [];
  let peak = 0;
  for (let i = 0; i < pcm.length; i += 64) peak = Math.max(peak, Math.abs(pcm[i]));
  if (peak < 1e-4) return [];
  const { fps, flux } = bandFlux(pcm, sampleRate);
  const maxOf = (c: Float32Array) => {
    let m = 1e-9;
    for (let i = 0; i < c.length; i++) m = Math.max(m, c[i]);
    return m;
  };
  const kickMax = maxOf(flux.kick);
  const snareMax = maxOf(flux.snare);
  const hatMax = maxOf(flux.hat);
  const hits: DrumHit[] = [];
  for (const kind of Object.keys(BANDS) as DrumKind[]) {
    let peaks = pickPeaks(flux[kind], fps, DRUM_THRESHOLDS[kind]);
    if (kind === 'snare') {
      // snare 是寬頻雜訊：同時刻高頻帶也要跳；kick 的掃頻起點與 bass 泛音漏進來時 kick 頻帶更強，不算 snare
      peaks = peaks.filter((p) => {
        const k = windowMax(flux.kick, p.index, CROSS_WINDOW) / kickMax;
        const h = windowMax(flux.hat, p.index, CROSS_WINDOW) / hatMax;
        const sN = p.strength / snareMax;
        return h >= SNARE_NEEDS_HIGH && (k <= SNARE_KICK_CEILING || sN >= k);
      });
    }
    const maxStrength = Math.max(...peaks.map((p) => p.strength), 1e-9);
    for (const p of peaks) {
      // 幀 f 的 flux 是幀 f-1 → f 的跳升；扣掉前面補的靜音（FFT_SIZE 個樣本）。
      // flux 在瞬態剛進視窗時就衝到頂，比真正的 onset 早約 30 ms，加回去。
      const time = Math.max(0, (p.index - 0.5) / fps - FFT_SIZE / sampleRate + ONSET_LAG);
      hits.push({
        time,
        kind,
        velocity: Math.max(MIN_VELOCITY, Math.min(1, p.strength / maxStrength)),
      });
    }
  }
  return hits.sort((a, b) => a.time - b.time);
}

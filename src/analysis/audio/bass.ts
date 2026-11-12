import type { BassNote } from '../types';
import { fft } from './fft';

const TARGET_SR = 22050;
const FFT_SIZE = 8192;
const FPS = 50;
const MIN_HZ = 30;
const MAX_HZ = 250;
/** 低頻能量低於整首最大值的這個比例 → 沒有 bass */
const ENERGY_GATE = 0.05;
/** 峰值要是低頻平均的幾倍才算有明確基頻 */
const CONF_GATE = 6;
const MIN_NOTE_SECONDS = 0.06;
const BEND_SEMITONES = 0.5;
/** kick 蓋住 bass 起音的最長時間 */
const MASK_SECONDS = 0.15;
/** 往回延伸時，幀的連續音高離音符超過這個半音數就停 */
const PROXIMITY_SEMITONES = 1.0;
/** 同一個音被切成段時，間隔小於這個就接回去 */
const MERGE_GAP_SECONDS = 0.15;

export interface BassFrame {
  t: number;
  /** 連續值（可含小數半音），沒有明確基頻時 null */
  midi: number | null;
  conf: number;
  energy: number;
}

/** 簡單的 2:1 降採樣（平均相鄰樣本）；sampleRate 不是 44.1k 就按整數比例取。 */
function downsample(pcm: Float32Array, sampleRate: number): { pcm: Float32Array; sr: number } {
  const factor = Math.max(1, Math.round(sampleRate / TARGET_SR));
  if (factor === 1) return { pcm, sr: sampleRate };
  const out = new Float32Array(Math.floor(pcm.length / factor));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (let k = 0; k < factor; k++) s += pcm[i * factor + k];
    out[i] = s / factor;
  }
  return { pcm: out, sr: sampleRate / factor };
}

/**
 * 每幀在 30–250 Hz 找基頻：分數 = |X(f)| + 0.5|X(2f)| + 0.25|X(3f)| − 0.3|X(f/2)|，
 * 用拋物線內插把峰值精確到 bin 之間。
 */
export function bassPitchFrames(input: Float32Array, sampleRate: number): BassFrame[] {
  const down = downsample(input, sampleRate);
  const sr = down.sr;
  // 前後各補半個視窗的靜音，讓第一幀的中心在 t=0、最後一幀到結尾
  const pcm = new Float32Array(down.pcm.length + FFT_SIZE);
  pcm.set(down.pcm, FFT_SIZE / 2);
  const hop = Math.round(sr / FPS);
  const hann = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const hzPerBin = sr / FFT_SIZE;
  const bLo = Math.ceil(MIN_HZ / hzPerBin);
  const bHi = Math.floor(MAX_HZ / hzPerBin);
  const frames = Math.max(0, Math.floor((pcm.length - FFT_SIZE) / hop) + 1);
  const mag = new Float64Array(FFT_SIZE / 2);
  const out: BassFrame[] = [];
  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = pcm[start + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < FFT_SIZE / 2; b++) mag[b] = Math.hypot(re[b], im[b]);
    let total = 0;
    for (let b = bLo; b <= bHi; b++) total += mag[b];
    let best = -1;
    let bestScore = 0;
    for (let b = bLo; b <= bHi; b++) {
      const score = mag[b] + 0.5 * mag[2 * b] + 0.25 * mag[3 * b] - 0.3 * mag[Math.round(b / 2)];
      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    }
    const t = start / sr; // 補了半個視窗，所以視窗中心就是 start
    if (best < 0 || total <= 0) {
      out.push({ t, midi: null, conf: 0, energy: total });
      continue;
    }
    // 拋物線內插
    const a = mag[best - 1];
    const b0 = mag[best];
    const c = mag[best + 1];
    const denom = a - 2 * b0 + c;
    const delta = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
    const hz = (best + delta) * hzPerBin;
    const conf = mag[best] / (total / (bHi - bLo + 1));
    out.push({ t, midi: 69 + 12 * Math.log2(hz / 440), conf, energy: total });
  }
  return out;
}

/** 連續幀同一個半音（且過能量與信心門檻）就是一個音；音內的偏移 ≥ 0.5 半音記成 bend。 */
export function detectBass(input: Float32Array, sampleRate: number): BassNote[] {
  const frames = bassPitchFrames(input, sampleRate);
  if (frames.length === 0) return [];
  let maxEnergy = 0;
  for (const f of frames) maxEnergy = Math.max(maxEnergy, f.energy);
  if (maxEnergy <= 0) return [];
  const dt = frames.length > 1 ? frames[1].t - frames[0].t : 1 / FPS;

  const notes: BassNote[] = [];
  let cur: (BassNote & { lastBend: number }) | null = null;
  const close = () => {
    if (cur && cur.duration >= MIN_NOTE_SECONDS) {
      const { lastBend: _l, ...note } = cur;
      notes.push(note);
    }
    cur = null;
  };
  for (const f of frames) {
    const voiced = f.midi !== null && f.energy >= ENERGY_GATE * maxEnergy && f.conf >= CONF_GATE;
    if (!voiced || f.midi === null) {
      close();
      continue;
    }
    const midi = Math.round(f.midi);
    const t0 = f.t - dt / 2;
    if (cur && midi === cur.midi) {
      cur.duration = f.t + dt / 2 - cur.time;
      const dev = f.midi - cur.midi;
      if (Math.abs(dev - cur.lastBend) >= BEND_SEMITONES) {
        cur.bends.push({ time: f.t, semitones: dev });
        cur.lastBend = dev;
      }
    } else {
      close();
      cur = { time: Math.max(0, t0), duration: dt, midi, bends: [], lastBend: 0 };
    }
  }
  close();

  // 同一個音被 kick 切成幾段：間隔短的接回去
  const merged: BassNote[] = [];
  for (const n of notes) {
    const last = merged[merged.length - 1];
    if (last && last.midi === n.midi && n.time - (last.time + last.duration) < MERGE_GAP_SECONDS) {
      last.duration = n.time + n.duration - last.time;
      last.bends.push(...n.bends);
    } else merged.push(n);
  }

  // kick 會把起音那 100 ms 的基頻拉歪：往回延伸到音高還在一個半音內的幀（最多 MASK_SECONDS，不越過前一個音）
  const maxBack = Math.round(MASK_SECONDS / dt);
  for (let i = 0; i < merged.length; i++) {
    const n = merged[i];
    const floor = i > 0 ? merged[i - 1].time + merged[i - 1].duration : 0;
    let k = Math.round((n.time + dt / 2) / dt);
    let steps = 0;
    while (steps < maxBack && k - 1 >= 0) {
      const f = frames[k - 1];
      if (!f || f.midi === null || f.t - dt / 2 < floor) break;
      if (f.energy < ENERGY_GATE * maxEnergy || Math.abs(f.midi - n.midi) > PROXIMITY_SEMITONES)
        break;
      k--;
      steps++;
    }
    const newStart = Math.max(floor, frames[k].t - dt / 2, 0);
    if (newStart < n.time) {
      n.duration += n.time - newStart;
      n.time = newStart;
    }
  }
  return merged;
}

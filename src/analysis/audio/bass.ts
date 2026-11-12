import type { BassNote } from '../types';
import { fft } from './fft';

const TARGET_SR = 22050;
const FFT_SIZE = 8192;
const FPS = 50;
const MIN_HZ = 30;
const MAX_HZ = 250;
/** 低頻能量低於整首最大值的這個比例 → 沒有 bass */
const ENERGY_GATE = 0.05;
/** 泛音加總的最高分要是所有候選平均的幾倍才算有明確基頻 */
const CONF_GATE = 1.8;
/** 諧波度低於這個（kick 之類的寬頻聲）不算有基頻 */
const HARM_GATE = 0.72;
/** 基頻那格的能量至少要是最強泛音的這個比例，否則是 pad / string 被折了一個八度 */
const FUND_GATE = 0.2;
const MIN_NOTE_SECONDS = 0.1;
const BEND_SEMITONES = 0.5;
/** kick 蓋住 bass 起音的最長時間 */
const MASK_SECONDS = 0.15;
/** 往回延伸時，幀的連續音高離音符超過這個半音數就停 */
const PROXIMITY_SEMITONES = 1.0;
/** 夾在兩個同音中間、比這短的音（kick、pad 的殘影）丟掉，讓兩邊接回去 */
const BLIP_SECONDS = 0.12;
/** 同一個音被切成段時，間隔小於這個就接回去 */
const MERGE_GAP_SECONDS = 0.15;

export interface BassFrame {
  t: number;
  /** 連續值（可含小數半音），沒有明確基頻時 null */
  midi: number | null;
  conf: number;
  /** 0–1：能量落在泛音上的比例（相對於泛音之間） */
  harm: number;
  /** 0–1：基頻那格的能量 / 最強泛音的能量 */
  fund: number;
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

/** 候選基頻的範圍（B♭0–E3）；更高的多半是別的樂器或 bass 的泛音 */
const MIN_F0_MIDI = 22;
const MAX_F0_MIDI = 52;
/** 候選格點的間距（半音） */
const GRID_STEP = 0.1;
/** 峰值落在最低這幾格就當成沒有基頻 */
const EDGE_STEPS = 3;
/** 加總幾個泛音、每個泛音的權重衰減 */
const HARMONICS = 6;
const HARMONIC_DECAY = 0.85;

/**
 * 每幀用泛音加總（subharmonic summation）找 bass 基頻：
 * 分數(f) = Σ_h DECAY^(h−1) · c(h·f)，c 是開根號、扣掉雜訊底的振幅。
 * 基音很弱、能量在 2f、3f 的 bass（失真 bass、808）也能抓到正確八度；
 * 不會把 3f 當成基頻（五度錯），因為 f 的分數同時吃到 2f、3f、4f…
 * conf = 最高分 / 所有候選的平均分。
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
  // 雜訊底與泛音查表都只看到 HARMONICS × 最高候選
  const topBin = Math.min(
    FFT_SIZE / 2 - 2,
    Math.ceil((HARMONICS * 440 * 2 ** ((MAX_F0_MIDI - 69) / 12)) / hzPerBin) + 2,
  );
  const cands: number[] = [];
  for (let m = MIN_F0_MIDI; m <= MAX_F0_MIDI + 1e-9; m += GRID_STEP) cands.push(m);
  // 每個候選、每個泛音對應的 bin（取 ±半個 bin 內最大）
  const harmBins = cands.map((m) => {
    const f = 440 * 2 ** ((m - 69) / 12);
    const bins: number[] = [];
    for (let h = 1; h <= HARMONICS; h++) bins.push((h * f) / hzPerBin);
    return bins;
  });
  const weights = Array.from({ length: HARMONICS }, (_, h) => HARMONIC_DECAY ** h);
  const frames = Math.max(0, Math.floor((pcm.length - FFT_SIZE) / hop) + 1);
  const mag = new Float64Array(FFT_SIZE / 2);
  const c = new Float64Array(FFT_SIZE / 2);
  const sorted = new Float64Array(topBin - bLo + 1);
  const scores = new Float64Array(cands.length);
  const out: BassFrame[] = [];
  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = pcm[start + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b <= topBin + 1; b++) mag[b] = Math.hypot(re[b], im[b]);
    let total = 0;
    for (let b = bLo; b <= bHi; b++) total += mag[b];
    const t = start / sr; // 補了半個視窗，所以視窗中心就是 start
    if (total <= 0) {
      out.push({ t, midi: null, conf: 0, harm: 0, fund: 0, energy: total });
      continue;
    }
    // 開根號壓縮，扣掉雜訊底（中位數）
    for (let b = bLo; b <= topBin; b++) sorted[b - bLo] = Math.sqrt(mag[b]);
    sorted.sort();
    const floor = sorted[sorted.length >> 1];
    for (let b = 0; b <= topBin + 1; b++) c[b] = Math.max(0, Math.sqrt(mag[b]) - floor);
    let best = -1;
    let bestScore = 0;
    let sum = 0;
    for (let k = 0; k < cands.length; k++) {
      const bins = harmBins[k];
      let s = 0;
      for (let h = 0; h < HARMONICS; h++) {
        const x = bins[h];
        const i0 = Math.floor(x);
        s += weights[h] * Math.max(c[i0], c[i0 + 1]);
      }
      scores[k] = s;
      sum += s;
      if (s > bestScore) {
        bestScore = s;
        best = k;
      }
    }
    // 峰值卡在最低的格點上（分數一路往下爬）＝ kick 之類的寬頻低頻，不是音高
    if (best <= EDGE_STEPS || bestScore <= 0) {
      out.push({ t, midi: null, conf: 0, harm: 0, fund: 0, energy: total });
      continue;
    }
    // 諧波度：泛音格點上的能量 vs 泛音中間點（(h+½)·f）的能量；kick 這種寬頻聲兩者差不多
    let between = 0;
    const bb = harmBins[best];
    for (let h = 0; h < HARMONICS - 1; h++) {
      const x = (bb[h] + bb[h + 1]) / 2;
      const i0 = Math.floor(x);
      between += weights[h] * Math.max(c[i0], c[i0 + 1]);
    }
    const harm = bestScore / (bestScore + between);
    // 基頻本身要有能量：pad、string、fx 坐在 150–300 Hz 時，泛音加總會把它們往下折一個八度；
    // 那個「低八度」的基頻格子是空的，靠這個分辨
    let partMax = 0;
    for (let h = 0; h < HARMONICS; h++) {
      const i0 = Math.floor(bb[h]);
      partMax = Math.max(partMax, c[i0], c[i0 + 1]);
    }
    const f0 = Math.floor(bb[0]);
    const fund = partMax > 0 ? Math.max(c[f0], c[f0 + 1]) / partMax : 0;
    // 拋物線內插（在候選格點上）
    const a = scores[best - 1] ?? scores[best];
    const b0 = scores[best];
    const cc = scores[best + 1] ?? scores[best];
    const denom = a - 2 * b0 + cc;
    const delta = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - cc)) / denom)) : 0;
    const midi = cands[best] + delta * GRID_STEP;
    out.push({ t, midi, conf: bestScore / (sum / cands.length), harm, fund, energy: total });
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
    const voiced =
      f.midi !== null &&
      f.energy >= ENERGY_GATE * maxEnergy &&
      f.conf >= CONF_GATE &&
      f.harm >= HARM_GATE &&
      f.fund >= FUND_GATE;
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

  // A 短B A：短 B 丟掉
  const kept = notes.filter((n, i) => {
    const prev = notes[i - 1];
    const next = notes[i + 1];
    return !(
      n.duration < BLIP_SECONDS &&
      prev &&
      next &&
      prev.midi === next.midi &&
      prev.midi !== n.midi
    );
  });

  // 同一個音被 kick 切成幾段：間隔短的接回去
  const merged: BassNote[] = [];
  for (const n of kept) {
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

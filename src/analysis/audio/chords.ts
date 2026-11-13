import { pcFromName, pcName } from '../../looks/music';
import type { BassNote, ChordEvent, KeyInfo, NoteEvent } from '../types';
import { getEssentia } from './essentia';

const SR = 44100;
const FRAME = 4096;
const HOP = 2048;

/** 和弦品質：模板的半音間隔與顯示後綴 */
export const QUALITIES = [
  { suffix: '', intervals: [0, 4, 7] },
  { suffix: 'm', intervals: [0, 3, 7] },
  { suffix: '7', intervals: [0, 4, 7, 10] },
  { suffix: 'm7', intervals: [0, 3, 7, 10] },
  { suffix: 'maj7', intervals: [0, 4, 7, 11] },
] as const;

export interface ChordOptions {
  /** 換和弦的代價（Viterbi）：越大越黏，碎片越少 */
  switchPenalty?: number;
  /** bass 在根音時的加分（只加根音：A C E G 配 bass C 要叫 C，不是 Am7） */
  bassBonus?: number;
  /** 所有和弦的相似度都低於這個值的拍當作沒有和弦 */
  noChord?: number;
}

const DEFAULTS: Required<ChordOptions> = { switchPenalty: 0.3, bassBonus: 0.2, noChord: 0.4 };

interface State {
  root: number;
  quality: number;
  template: Float32Array;
}

const STATES: State[] = [];
for (let root = 0; root < 12; root++) {
  QUALITIES.forEach((q, quality) => {
    const template = new Float32Array(12);
    for (const i of q.intervals) template[(root + i) % 12] = 1;
    STATES.push({ root, quality, template });
  });
}
const N_STATE = STATES.length; // 沒有和弦

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < 12; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

export function chordName(root: number, quality: number): string {
  return `${pcName(root)}${QUALITIES[quality].suffix}`;
}

/**
 * 逐拍 chroma → 和弦事件（純函式）。
 * 每拍對 12 根音 × 5 品質的模板算 cosine 相似度，bass 在根音加分，
 * 再用 Viterbi 找「相似度總和 − 換和弦次數 × 代價」最大的路徑，相同和弦的連續拍併成一個事件。
 * chroma[i] 是第 i 拍（beats[i] 到 beats[i+1]）的 12 維 pitch-class 強度；bassPc[i] 是該拍 bass 的 pitch class（沒有 = -1）。
 * 最後一拍的長度用前一拍的。
 */
export function chordsFromChroma(
  chroma: readonly ArrayLike<number>[],
  beats: readonly number[],
  bassPc: readonly number[] = [],
  opts: ChordOptions = {},
): ChordEvent[] {
  const o = { ...DEFAULTS, ...opts };
  const n = Math.min(chroma.length, beats.length);
  if (n === 0) return [];
  // 發射分數
  const emit: Float32Array[] = [];
  for (let b = 0; b < n; b++) {
    const e = new Float32Array(N_STATE + 1);
    const bass = bassPc[b] ?? -1;
    for (let s = 0; s < N_STATE; s++) {
      const st = STATES[s];
      let v = cosine(chroma[b], st.template);
      if (bass === st.root) v += o.bassBonus;
      e[s] = v;
    }
    e[N_STATE] = o.noChord;
    emit.push(e);
  }
  // Viterbi
  const S = N_STATE + 1;
  let score = Float32Array.from(emit[0]);
  const back: Int16Array[] = [];
  for (let b = 1; b < n; b++) {
    let bestPrev = 0;
    for (let s = 1; s < S; s++) if (score[s] > score[bestPrev]) bestPrev = s;
    const next = new Float32Array(S);
    const bp = new Int16Array(S);
    for (let s = 0; s < S; s++) {
      const stay = score[s];
      const sw = score[bestPrev] - o.switchPenalty;
      if (stay >= sw) {
        next[s] = stay + emit[b][s];
        bp[s] = s;
      } else {
        next[s] = sw + emit[b][s];
        bp[s] = bestPrev;
      }
    }
    score = next;
    back.push(bp);
  }
  let s = 0;
  for (let k = 1; k < S; k++) if (score[k] > score[s]) s = k;
  const path = new Array<number>(n);
  for (let b = n - 1; b >= 0; b--) {
    path[b] = s;
    if (b > 0) s = back[b - 1][s];
  }
  // 連續同和弦併成事件
  const events: ChordEvent[] = [];
  const lastLen = n >= 2 ? beats[n - 1] - beats[n - 2] : 0.5;
  const endOf = (b: number) => (b + 1 < n ? beats[b + 1] : beats[n - 1] + lastLen);
  for (let b = 0; b < n; b++) {
    const st = path[b];
    const prev = events[events.length - 1];
    if (st === N_STATE) continue;
    const { root, quality } = STATES[st];
    if (prev && b > 0 && path[b - 1] === st) {
      prev.duration = endOf(b) - prev.time;
      continue;
    }
    const notes = QUALITIES[quality].intervals.map((i) => (root + i) % 12);
    events.push({
      time: beats[b],
      duration: endOf(b) - beats[b],
      root,
      name: chordName(root, quality),
      notes,
    });
  }
  return events;
}

/** 每拍 bass 的 pitch class：拍內重疊最久的那顆 bass 音；沒有就 -1 */
export function bassPcPerBeat(bass: readonly BassNote[], beats: readonly number[]): number[] {
  const out: number[] = [];
  for (let b = 0; b < beats.length; b++) {
    const start = beats[b];
    const end = b + 1 < beats.length ? beats[b + 1] : start + (b > 0 ? start - beats[b - 1] : 0.5);
    let best = -1;
    let bestOverlap = 0;
    for (const note of bass) {
      const overlap = Math.min(end, note.time + note.duration) - Math.max(start, note.time);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = ((note.midi % 12) + 12) % 12;
      }
    }
    out.push(best);
  }
  return out;
}

/** 逐幀 HPCP 依拍平均成逐拍 chroma（幀中心落在拍內的才算） */
export function chromaPerBeat(
  frames: readonly ArrayLike<number>[],
  frameCenters: readonly number[],
  beats: readonly number[],
): Float32Array[] {
  const out: Float32Array[] = [];
  let f = 0;
  for (let b = 0; b < beats.length; b++) {
    const start = beats[b];
    const end = b + 1 < beats.length ? beats[b + 1] : Number.POSITIVE_INFINITY;
    const acc = new Float32Array(12);
    let count = 0;
    while (f < frames.length && frameCenters[f] < start) f++;
    while (f < frames.length && frameCenters[f] < end) {
      for (let i = 0; i < 12; i++) acc[i] += frames[f][i];
      count++;
      f++;
    }
    if (count > 0) for (let i = 0; i < 12; i++) acc[i] /= count;
    out.push(acc);
  }
  return out;
}

const beatEnd = (beats: readonly number[], b: number) =>
  b + 1 < beats.length ? beats[b + 1] : beats[b] + (b > 0 ? beats[b] - beats[b - 1] : 0.5);

/** 逐拍 chroma 從轉譜出來的音符算：拍內每顆在響的音，依重疊時間 × 力度加到它的 pitch class */
export function chromaFromNotes(
  notes: readonly NoteEvent[],
  beats: readonly number[],
): Float32Array[] {
  const out: Float32Array[] = [];
  for (let b = 0; b < beats.length; b++) {
    const start = beats[b];
    const end = beatEnd(beats, b);
    const c = new Float32Array(12);
    for (const n of notes) {
      const overlap = Math.min(end, n.time + n.duration) - Math.max(start, n.time);
      if (overlap > 0) c[((n.midi % 12) + 12) % 12] += overlap * n.velocity;
    }
    out.push(c);
  }
  return out;
}

/** 沒有 bass 讀數時：每拍最低的那顆音（midi ≤ 55 才算 bass）的 pitch class */
export function lowestPcPerBeat(
  notes: readonly NoteEvent[],
  beats: readonly number[],
  maxMidi = 55,
): number[] {
  const out: number[] = [];
  for (let b = 0; b < beats.length; b++) {
    const start = beats[b];
    const end = beatEnd(beats, b);
    let lowest = Number.POSITIVE_INFINITY;
    for (const n of notes) {
      if (n.midi > maxMidi || n.midi >= lowest) continue;
      if (Math.min(end, n.time + n.duration) - Math.max(start, n.time) > 0) lowest = n.midi;
    }
    out.push(Number.isFinite(lowest) ? lowest % 12 : -1);
  }
  return out;
}

/**
 * 從轉譜的音符（Basic Pitch）算和弦：比 HPCP 乾淨得多（合成歌根音 44% → 100%），
 * 有 notes 時優先用這條。bass 給 detectBass 的結果；沒有就用每拍最低的音。沒有拍點就每 0.5 s 一拍。
 */
export function chordsFromNotes(
  notes: readonly NoteEvent[],
  beats: readonly number[],
  bass: readonly BassNote[] = [],
  opts: ChordOptions = {},
): ChordEvent[] {
  if (notes.length === 0) return [];
  const grid =
    beats.length >= 2 ? beats : fallbackBeats(Math.max(...notes.map((n) => n.time + n.duration)));
  const bassPc = bass.length ? bassPcPerBeat(bass, grid) : lowestPcPerBeat(notes, grid);
  return chordsFromChroma(chromaFromNotes(notes, grid), grid, bassPc, opts);
}

/** 沒有拍點時用的假拍：每 0.5 s 一拍 */
function fallbackBeats(seconds: number): number[] {
  const out: number[] = [];
  for (let t = 0; t < seconds; t += 0.5) out.push(t);
  return out;
}

/**
 * HPCP 逐幀 → 逐拍 chroma → 模板 + bass + Viterbi；調性用 KeyExtractor。pcm 必須是 44.1 kHz。
 * bass 是 detectBass 的結果（有的話），用來分辨 Am7 和 C、以及轉位。
 */
export async function detectChords(
  pcm: Float32Array,
  beats: number[],
  bass: readonly BassNote[] = [],
  opts: ChordOptions = {},
): Promise<{ chords: ChordEvent[]; key?: KeyInfo }> {
  if (pcm.length < FRAME * 2) return { chords: [] };
  let peak = 0;
  for (let i = 0; i < pcm.length; i += 64) peak = Math.max(peak, Math.abs(pcm[i]));
  if (peak < 1e-4) return { chords: [] };

  const ess = await getEssentia();
  const frames = ess.FrameGenerator(pcm, FRAME, HOP);
  const n = frames.size();
  const hpcps: Float32Array[] = [];
  const centers: number[] = [];
  for (let i = 0; i < n; i++) {
    const win = ess.Windowing(frames.get(i), true, FRAME, 'blackmanharris62');
    const spec = ess.Spectrum(win.frame, FRAME);
    const peaks = ess.SpectralPeaks(spec.spectrum, 0, 5000, 60, 20, 'frequency', SR);
    const hpcp = ess.HPCP(
      peaks.frequencies,
      peaks.magnitudes,
      true,
      500,
      0,
      5000,
      false,
      40,
      false,
      'unitMax',
      440,
      SR,
      12,
      'squaredCosine',
      1,
    );
    // essentia 的 HPCP 第 0 格是參考音 A（440 Hz），轉成 C = 0
    const raw = ess.vectorToArray(hpcp.hpcp);
    const rotated = new Float32Array(12);
    for (let bin = 0; bin < 12; bin++) rotated[(bin + 9) % 12] = raw[bin];
    hpcps.push(rotated);
    centers.push((i * HOP + FRAME / 2) / SR);
  }
  const grid = beats.length >= 2 ? beats : fallbackBeats(pcm.length / SR);
  const chroma = chromaPerBeat(hpcps, centers, grid);
  const chords = chordsFromChroma(chroma, grid, bassPcPerBeat(bass, grid), opts);

  const k = ess.KeyExtractor(ess.arrayToVector(pcm));
  const tonic = pcFromName(k.key);
  const key: KeyInfo | undefined =
    tonic >= 0 && k.strength > 0
      ? {
          tonic,
          mode: k.scale === 'minor' ? 'minor' : 'major',
          name: `${pcName(tonic)} ${k.scale === 'minor' ? 'minor' : 'major'}`,
        }
      : undefined;
  return { chords, key };
}

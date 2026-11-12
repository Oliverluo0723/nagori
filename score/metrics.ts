import type { BassNote, ChordEvent, DrumHit } from '../src/analysis/types';

export interface TruthNote {
  time: number;
  duration: number;
  midi: number;
}
export interface TruthChord {
  time: number;
  duration: number;
  /** pitch class 0–11 */
  root: number;
}
export interface TruthDrum {
  time: number;
  kind: DrumHit['kind'];
}
/** 一首歌的標準答案（samples/score/<name>.json） */
export interface SongTruth {
  name: string;
  /** 音檔路徑，相對於 repo 根 */
  audio: string;
  /** 分軌目錄（有 bass.wav / drums.wav / other.wav 就用），相對於 repo 根 */
  stems?: string;
  bass?: TruthNote[];
  chords?: TruthChord[];
  drums?: TruthDrum[];
}

export interface F1 {
  precision: number;
  recall: number;
  f1: number;
}

const ONSET_TOL = 0.05;

function f1(matched: number, predicted: number, truth: number): F1 {
  const precision = predicted > 0 ? matched / predicted : 0;
  const recall = truth > 0 ? matched / truth : 0;
  const f = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1: f };
}

/**
 * 音符 F1：起音在 ±onsetTol 內且 midi 相等算中，每個真值最多配一個預測（貪婪、依時間）。
 * 八度錯（起音對、midi 差 12 的倍數）不算中，另計 octaveErrors。
 */
export function noteF1(
  pred: BassNote[],
  truth: TruthNote[],
  onsetTol = ONSET_TOL,
): F1 & { octaveErrors: number } {
  const used = new Set<number>();
  let matched = 0;
  let octaveErrors = 0;
  for (const t of truth) {
    let hit = -1;
    let octave = false;
    for (let i = 0; i < pred.length; i++) {
      if (used.has(i) || Math.abs(pred[i].time - t.time) > onsetTol) continue;
      if (pred[i].midi === t.midi) {
        hit = i;
        break;
      }
      if ((pred[i].midi - t.midi) % 12 === 0) octave = true;
    }
    if (hit >= 0) {
      used.add(hit);
      matched++;
    } else if (octave) octaveErrors++;
  }
  return { ...f1(matched, pred.length, truth.length), octaveErrors };
}

/**
 * 音高時間正確率：真值有音的時間裡，預測在同一時刻報出同一個 midi 的比例（每 10 ms 取樣）。
 * 不受分段方式影響：偵測器把連續同音接成一段、或切成好幾段都一樣。
 */
export function pitchTimeAccuracy(pred: BassNote[], truth: TruthNote[], step = 0.01): number {
  let total = 0;
  let right = 0;
  for (const t of truth) {
    for (let x = t.time + step / 2; x < t.time + t.duration; x += step) {
      total++;
      if (pred.some((p) => p.midi === t.midi && x >= p.time && x < p.time + p.duration)) right++;
    }
  }
  return total > 0 ? right / total : 0;
}

/** 和弦根音正確率：以真值的時間長度加權，取預測在該時刻的根音 */
export function chordRootAccuracy(pred: ChordEvent[], truth: TruthChord[]): number {
  const total = truth.reduce((s, c) => s + c.duration, 0);
  if (total <= 0) return 0;
  let right = 0;
  for (const t of truth) {
    for (const p of pred) {
      if (p.root !== t.root) continue;
      const overlap = Math.min(p.time + p.duration, t.time + t.duration) - Math.max(p.time, t.time);
      if (overlap > 0) right += overlap;
    }
  }
  return right / total;
}

/** 每類鼓的 F1（起音 ±tol） */
export function drumF1(
  pred: DrumHit[],
  truth: TruthDrum[],
  tol = ONSET_TOL,
): Record<DrumHit['kind'], number> {
  const out = { kick: 0, snare: 0, hat: 0 };
  for (const kind of ['kick', 'snare', 'hat'] as const) {
    const p = pred.filter((h) => h.kind === kind);
    const t = truth.filter((h) => h.kind === kind);
    const used = new Set<number>();
    let matched = 0;
    for (const th of t) {
      const i = p.findIndex((ph, k) => !used.has(k) && Math.abs(ph.time - th.time) <= tol);
      if (i >= 0) {
        used.add(i);
        matched++;
      }
    }
    out[kind] = f1(matched, p.length, t.length).f1;
  }
  return out;
}

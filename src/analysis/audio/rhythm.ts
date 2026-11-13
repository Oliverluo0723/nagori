import type { RhythmInfo } from '../types';
import { getEssentia } from './essentia';

const MIN_SECONDS = 3;
const MIN_BPM = 60;
const MAX_BPM = 200;

const EMPTY: RhythmInfo = { bpm: 0, confidence: 0, beats: [], candidates: [], offset: 0 };

/** [bpm, ×2, ÷2, ×4/3, ×3/4]，四捨五入到 0.1，只留 60–200，去重，原 bpm 在最前面。 */
export function bpmCandidates(bpm: number): number[] {
  if (!(bpm > 0)) return [];
  const raw = [bpm, bpm * 2, bpm / 2, (bpm * 4) / 3, (bpm * 3) / 4];
  const out: number[] = [];
  for (const v of raw) {
    const r = Math.round(v * 10) / 10;
    if (r < MIN_BPM || r > MAX_BPM) continue;
    if (!out.includes(r)) out.push(r);
  }
  return out;
}

const NEAR_ZERO = 0.06;

/**
 * 所有拍點相對一拍的相位取圓周平均（essentia 在靜音前奏裡會多給幾個不準的 tick，
 * 不能只看第一個）。結果落在 [0, beat)；離整拍不到 60 ms 的折成小負數，
 * 讓「幾乎對齊」的歌第 1 小節從 0 附近開始而不是從第 2 拍。
 */
export function firstBeatOffset(beats: number[], bpm: number): number {
  if (beats.length === 0 || !(bpm > 0)) return 0;
  const beat = 60 / bpm;
  let sx = 0;
  let sy = 0;
  for (const t of beats) {
    const a = (2 * Math.PI * (((t % beat) + beat) % beat)) / beat;
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  let phase = (Math.atan2(sy, sx) / (2 * Math.PI)) * beat;
  phase = ((phase % beat) + beat) % beat;
  if (phase > beat - NEAR_ZERO) phase -= beat;
  return phase;
}

const SILENCE_DB = -40;
const HOP_SEC = 0.05;

/**
 * 去掉開頭與結尾落在靜音裡的 tick（essentia 在前奏靜音、尾奏淡出後還會多給幾個）。
 * 「靜音」= 該 tick 前後 50 ms 的 RMS 都比全曲最大 RMS 小 40 dB 以上。中間的不動（breakdown 也有拍）。
 */
export function trimSilentTicks(beats: number[], pcm: Float32Array, sampleRate: number): number[] {
  if (beats.length === 0) return beats;
  const hop = Math.max(1, Math.round(HOP_SEC * sampleRate));
  const n = Math.ceil(pcm.length / hop);
  const rms = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    const end = Math.min(pcm.length, (i + 1) * hop);
    for (let k = i * hop; k < end; k++) s += pcm[k] * pcm[k];
    rms[i] = Math.sqrt(s / Math.max(1, end - i * hop));
    peak = Math.max(peak, rms[i]);
  }
  const floor = peak * 10 ** (SILENCE_DB / 20);
  const silent = (t: number) => {
    const c = Math.floor(t / HOP_SEC);
    for (let i = Math.max(0, c - 1); i <= Math.min(n - 1, c + 1); i++) if (rms[i] >= floor) return false;
    return true;
  };
  let lo = 0;
  let hi = beats.length;
  while (lo < hi && silent(beats[lo])) lo++;
  while (hi > lo && silent(beats[hi - 1])) hi--;
  return beats.slice(lo, hi);
}

const ACCENT_TOL = 0.07;

/**
 * 強拍在哪：每個「重音」（kick、和弦換的時刻…）投給離它最近的拍（±70 ms），
 * 票數依 拍序 mod beatsPerBar 加總，最多的那個 phase 的第一拍就是第 1 小節第 1 拍。
 * 回傳 beats 的 index（沒有票就 0）。
 */
export function downbeatIndex(
  beats: readonly number[],
  accents: readonly { time: number; weight: number }[],
  beatsPerBar = 4,
): number {
  if (beats.length === 0) return 0;
  const votes = new Array<number>(beatsPerBar).fill(0);
  for (const a of accents) {
    let best = -1;
    let bestD = ACCENT_TOL;
    for (let i = 0; i < beats.length; i++) {
      const d = Math.abs(beats[i] - a.time);
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) votes[best % beatsPerBar] += a.weight;
  }
  let phase = 0;
  for (let p = 1; p < beatsPerBar; p++) if (votes[p] > votes[phase]) phase = p;
  return Math.min(phase, beats.length - 1);
}

/** essentia RhythmExtractor2013；pcm 必須是 44.1 kHz 單聲道。 */
export async function analyzeRhythm(pcm: Float32Array): Promise<RhythmInfo> {
  if (pcm.length < MIN_SECONDS * 44100) return EMPTY;
  let peak = 0;
  for (let i = 0; i < pcm.length; i += 64) peak = Math.max(peak, Math.abs(pcm[i]));
  if (peak < 1e-4) return EMPTY;
  const ess = await getEssentia();
  const vec = ess.arrayToVector(pcm);
  const r = ess.RhythmExtractor2013(vec, 208, 'multifeature', 40);
  const beats = trimSilentTicks(Array.from(ess.vectorToArray(r.ticks)), pcm, 44100);
  if (!(r.bpm > 0) || beats.length === 0) return EMPTY;
  const bpm = Math.round(r.bpm * 100) / 100;
  return {
    bpm,
    confidence: r.confidence,
    beats,
    candidates: bpmCandidates(bpm),
    offset: firstBeatOffset(beats, bpm),
  };
}

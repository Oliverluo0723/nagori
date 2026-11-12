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

/** essentia RhythmExtractor2013；pcm 必須是 44.1 kHz 單聲道。 */
export async function analyzeRhythm(pcm: Float32Array): Promise<RhythmInfo> {
  if (pcm.length < MIN_SECONDS * 44100) return EMPTY;
  let peak = 0;
  for (let i = 0; i < pcm.length; i += 64) peak = Math.max(peak, Math.abs(pcm[i]));
  if (peak < 1e-4) return EMPTY;
  const ess = await getEssentia();
  const vec = ess.arrayToVector(pcm);
  const r = ess.RhythmExtractor2013(vec, 208, 'multifeature', 40);
  const beats = Array.from(ess.vectorToArray(r.ticks));
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

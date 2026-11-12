import type { NoteEvent } from '../types';

/**
 * 轉譜的純函式部分（Node 可測，不碰 TensorFlow）：重採樣、Basic Pitch 輸出 → NoteEvent[]、整理。
 * 推論本身在 transcribe.ts，只在瀏覽器／Worker 跑。
 */

/** Basic Pitch 要的取樣率 */
export const BP_SAMPLE_RATE = 22050;

/** Basic Pitch 後處理的三個門檻（outputToNotesPoly 的參數）；之後 `pnpm score` 可以掃 */
export interface NoteThresholds {
  /** onset 機率門檻 */
  onset: number;
  /** frame 機率門檻 */
  frame: number;
  /** 最短音長，以模型 frame 計（約 86 fps，11 ≈ 0.12 s） */
  minFrames: number;
}

/** spike（2026-11-12）用的值，當起點 */
export const NOTE_THRESHOLDS: NoteThresholds = { onset: 0.5, frame: 0.3, minFrames: 11 };

/** Basic Pitch noteFramesToTime 吐出來的形狀 */
export interface RawNote {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
  amplitude: number;
}

/**
 * 任意取樣率 → 22 050 Hz 單聲道。44 100 Hz 就兩兩取平均（夠用的低通 + 抽取）；
 * 已經是 22 050 Hz 原樣複製；其他取樣率用線性內插。
 */
export function resampleForBasicPitch(pcm: Float32Array, sampleRate: number): Float32Array {
  if (sampleRate === BP_SAMPLE_RATE) return Float32Array.from(pcm);
  if (sampleRate === BP_SAMPLE_RATE * 2) {
    const out = new Float32Array(Math.floor(pcm.length / 2));
    for (let i = 0; i < out.length; i++) out[i] = (pcm[2 * i] + pcm[2 * i + 1]) * 0.5;
    return out;
  }
  const ratio = sampleRate / BP_SAMPLE_RATE;
  const out = new Float32Array(Math.floor((pcm.length * BP_SAMPLE_RATE) / sampleRate + 1e-9));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const a = Math.min(pcm.length - 1, Math.floor(x));
    const b = Math.min(pcm.length - 1, a + 1);
    const f = x - a;
    out[i] = pcm[a] * (1 - f) + pcm[b] * f;
  }
  return out;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * 整理成資料契約要的樣子：時間 ≥ 0、midi 取整夾在 0–127、velocity 夾在 0..1、
 * 依 time（再依 midi）排序；同一個 midi 後一顆開始前，前一顆就結束（裁短前一顆），
 * 裁完長度 ≤ 0 的丟掉。不改傳進來的陣列。
 */
export function tidyNotes(notes: readonly NoteEvent[]): NoteEvent[] {
  const clean: NoteEvent[] = [];
  for (const n of notes) {
    if (!Number.isFinite(n.time) || !Number.isFinite(n.duration) || !Number.isFinite(n.midi))
      continue;
    // 開頭落在 0 之前的裁到 0（長度跟著扣）
    const time = Math.max(0, n.time);
    const duration = n.time < 0 ? n.time + n.duration : n.duration;
    if (!(duration > 0)) continue;
    const midi = Math.min(127, Math.max(0, Math.round(n.midi)));
    clean.push({ time, duration, midi, velocity: clamp01(n.velocity) });
  }
  clean.sort((a, b) => a.time - b.time || a.midi - b.midi || b.duration - a.duration);
  const lastOf = new Map<number, NoteEvent>();
  const out: NoteEvent[] = [];
  for (const n of clean) {
    const prev = lastOf.get(n.midi);
    if (prev && prev.time + prev.duration > n.time) {
      // 同一時間同一個音兩顆：留長的那顆（排序時長的在前）
      if (n.time === prev.time) continue;
      prev.duration = n.time - prev.time;
    }
    lastOf.set(n.midi, n);
    out.push(n);
  }
  return out;
}

/** Basic Pitch 的音符 → NoteEvent[]（力度 = amplitude 夾在 0..1），已整理 */
export function fromBasicPitch(raw: readonly RawNote[]): NoteEvent[] {
  return tidyNotes(
    raw.map((n) => ({
      time: n.startTimeSeconds,
      duration: n.durationSeconds,
      midi: n.pitchMidi,
      velocity: n.amplitude,
    })),
  );
}

/** 快取 key 的門檻後綴：門檻一改，舊快取自然失效 */
export function thresholdsKey(th: NoteThresholds): string {
  return `o${th.onset}-f${th.frame}-m${th.minFrames}`;
}

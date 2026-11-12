import { positionAt, timeOfBar } from '../analysis/tempo';
import type { TempoMap } from '../analysis/types';

/** 輸出長度：秒數，或整首（0 秒到結尾，不管播放線在哪）。 */
export type ExportLength = 15 | 30 | 'full';

export interface ExportRange {
  start: number;
  end: number;
}

export interface RangeInput {
  length: ExportLength;
  playhead: number;
  /** 起點吸附到最近的小節開頭 */
  snap: boolean;
  tempo: TempoMap;
  duration: number;
}

/** 最近的小節開頭；第一拍之前的小節開頭可能是負的，夾到 0。 */
export function nearestBarStart(tempo: TempoMap, t: number): number {
  const { bar } = positionAt(tempo, t);
  const a = timeOfBar(tempo, bar);
  const b = timeOfBar(tempo, bar + 1);
  return Math.max(0, t - a <= b - t ? a : b);
}

/**
 * 輸出的片段。起點從播放線（可吸附小節）；
 * 播放線太靠近結尾、湊不滿長度時整段往前挪，片子永遠是選的長度（歌比長度短除外）。
 */
export function exportRange(input: RangeInput): ExportRange {
  const { length, playhead, snap, tempo, duration } = input;
  if (length === 'full' || duration <= length) return { start: 0, end: duration };
  let start = snap ? nearestBarStart(tempo, playhead) : playhead;
  start = Math.min(Math.max(0, start), duration - length);
  return { start, end: start + length };
}

/** 第 i 幀畫歌的哪個時間。幀數取整，所以同一段永遠是同樣的幀。 */
export function frameCount(range: ExportRange, fps: number): number {
  return Math.max(1, Math.round((range.end - range.start) * fps));
}

export function frameTime(range: ExportRange, fps: number, i: number): number {
  return range.start + i / fps;
}

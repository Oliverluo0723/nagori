import type { DrumHit, DrumKind } from '../analysis/types';

/** 彈奏模式的速度（固定） */
export const LIVE_BPM = 120;
/** 一小節幾格（16 分音符） */
export const BEAT_STEPS = 16;
const STEP = 60 / LIVE_BPM / 4;

/** 自動節奏：一小節 16 格裡哪一格打什麼。同一格的順序 kick、snare、hat。 */
const PATTERN: { step: number; kind: DrumKind; velocity: number }[] = [];
for (let step = 0; step < BEAT_STEPS; step++) {
  if (step === 0 || step === 6 || step === 8) PATTERN.push({ step, kind: 'kick', velocity: 1 });
  if (step === 4 || step === 12) PATTERN.push({ step, kind: 'snare', velocity: 0.9 });
  if (step % 2 === 0) PATTERN.push({ step, kind: 'hat', velocity: 0.6 });
}

/** 自動節奏在 [from, to) 秒裡的鼓點，依時間排序；時間 0 是第一次按鍵。 */
export function beatHits(from: number, to: number): DrumHit[] {
  const hits: DrumHit[] = [];
  const start = Math.max(0, from);
  if (to <= start) return hits;
  const barLen = STEP * BEAT_STEPS;
  for (let bar = Math.floor(start / barLen); bar * barLen < to; bar++) {
    for (const p of PATTERN) {
      const time = bar * barLen + p.step * STEP;
      if (time >= start && time < to) hits.push({ time, kind: p.kind, velocity: p.velocity });
    }
  }
  return hits;
}

/** 預排多遠（秒） */
const AHEAD = 0.1;
/** 落後超過這麼多的拍子丟掉（秒） */
const MAX_LATE = 0.05;

/**
 * 自動節奏的聲音預排：從上次排到的 until 排到 now + AHEAD。
 * 分頁在背景時計時器會變慢，回來時落後太多的拍子直接丟掉，不一次補一串。
 */
export function nextBeats(until: number, now: number): { hits: DrumHit[]; until: number } {
  const end = now + AHEAD;
  return { hits: beatHits(Math.max(until, now - MAX_LATE), end), until: Math.max(until, end) };
}

import { bandEnergy, binValue } from '../analysis/audio/spectrum';
import { bpmAt, timeOfBar } from '../analysis/tempo';
import type { Spectrum, TempoMap } from '../analysis/types';
import type { Painter } from './painter/painter';
import type { LookContext, ParamDef } from './types';

/**
 * Sheet 系 look 的共用工具：整首歌的彙總序列用 WeakMap 依 Spectrum 物件快取，
 * 所以每幀畫圖只掃「正在印的那一段」。沒有內部狀態影響輸出，同輸入同結果。
 */

const energyCache = new WeakMap<Spectrum, Float32Array>();
const bandCache = new WeakMap<Spectrum, Map<string, Float32Array>>();

/** 每幀所有 bin 的平均，0..1。 */
export function energySeries(s: Spectrum): Float32Array {
  const hit = energyCache.get(s);
  if (hit) return hit;
  const out = new Float32Array(s.frameCount);
  for (let f = 0; f < s.frameCount; f++) {
    let sum = 0;
    for (let b = 0; b < s.bins; b++) sum += binValue(s, f, b);
    out[f] = s.bins ? sum / s.bins : 0;
  }
  energyCache.set(s, out);
  return out;
}

/** 每幀 loHz..hiHz 的平均，0..1。 */
export function bandSeries(s: Spectrum, loHz: number, hiHz: number): Float32Array {
  let bands = bandCache.get(s);
  if (!bands) {
    bands = new Map();
    bandCache.set(s, bands);
  }
  const key = `${loHz}-${hiHz}`;
  const hit = bands.get(key);
  if (hit) return hit;
  const out = new Float32Array(s.frameCount);
  for (let f = 0; f < s.frameCount; f++) out[f] = bandEnergy(s, f, loHz, hiHz);
  bands.set(key, out);
  return out;
}

/** 秒 → m:ss。 */
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 讀數字參數，沒給就用定義的預設；定義裡也沒有就 0。 */
export function paramNum(ctx: LookContext, defs: ParamDef[], key: string): number {
  const v = ctx.params[key];
  if (typeof v === 'number') return v;
  return defs.find((d) => d.key === key)?.default ?? 0;
}

/** t 所在那一拍的秒數。「剛印好的那一拍用強調色」的長度單位。 */
export function printedBeat(tempo: TempoMap, t: number): number {
  const bpm = bpmAt(tempo, t);
  return bpm > 0 ? 60 / bpm : 0.5;
}

/** 在 [a, b] 內線性插值取序列的平均；frame 以 fps 換算。空範圍回 0。 */
export function meanOver(series: Float32Array, fps: number, from: number, to: number): number {
  const a = Math.max(0, Math.floor(from * fps));
  const b = Math.min(series.length - 1, Math.floor(to * fps));
  if (b < a) return 0;
  let sum = 0;
  for (let f = a; f <= b; f++) sum += series[f];
  return sum / (b - a + 1);
}

/** 把小標畫在左上角，各 look 共用。 */
export function drawLabel(p: Painter, ctx: LookContext): void {
  if (!ctx.label) return;
  p.noStroke();
  p.fill(ctx.theme.mute);
  p.text(ctx.label, ctx.w * 0.03, ctx.h * 0.04, {
    size: ctx.h * 0.012,
    font: 'mono',
    align: 'left',
  });
}

/** 七個頻帶（低到高），名字照 Oto 的 Strata；color 是 theme.noteColors 的索引。 */
export const BANDS7: { name: string; lo: number; hi: number; color: number }[] = [
  { name: 'sub', lo: 30, hi: 60, color: 9 },
  { name: 'bass', lo: 60, hi: 250, color: 8 },
  { name: 'low-mids', lo: 250, hi: 500, color: 0 },
  { name: 'mids', lo: 500, hi: 2000, color: 3 },
  { name: 'high-mids', lo: 2000, hi: 4000, color: 11 },
  { name: 'presence', lo: 4000, hi: 10000, color: 7 },
  { name: 'air', lo: 10000, hi: 16000, color: 1 },
];

/** t 之前 seconds 秒內的平均（平滑後的「現在」）。 */
export function smoothAt(series: Float32Array, fps: number, t: number, seconds: number): number {
  return meanOver(series, fps, Math.max(0, t - seconds), t);
}

/** 第 1 小節起、每小節 perBar 個取樣時間，小於 limit 的全部。 */
export function barTimes(tempo: TempoMap, limit: number, perBar: number): number[] {
  const out: number[] = [];
  for (let bar = 1; bar < 100000; bar++) {
    const start = timeOfBar(tempo, bar);
    const end = timeOfBar(tempo, bar + 1);
    if (!(end > start)) break;
    for (let i = 0; i < perBar; i++) {
      const time = start + ((end - start) * i) / perBar;
      if (time >= limit) return out;
      out.push(time);
    }
  }
  return out;
}

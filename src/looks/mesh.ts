import { timeOfBar } from '../analysis/tempo';
import type { Spectrum, TempoMap } from '../analysis/types';
import type { Painter } from './painter/painter';
import { bandSeries, drawLabel, meanOver, paramNum, printedBeat } from './sheet';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'gain', label: '寬度', min: 0.5, max: 3, default: 1.6 },
  { key: 'perBeat', label: '每拍樣本', min: 1, max: 4, default: 1 },
];

/** 六條頻帶，高頻在上。 */
export const BANDS: [number, number][] = [
  [4000, 16000],
  [1500, 4000],
  [500, 1500],
  [200, 500],
  [80, 200],
  [30, 80],
];
const LEFT = 0.05;
const RIGHT = 0.95;
const TOP = 0.12;
const BOTTOM = 0.9;

const loudnessCache = new WeakMap<Spectrum, number[]>();

/** 每條頻帶整首歌的平均能量（快取）。 */
function laneLoudness(s: Spectrum): number[] {
  const hit = loudnessCache.get(s);
  if (hit) return hit;
  const out = BANDS.map(([lo, hi]) => {
    const series = bandSeries(s, lo, hi);
    let sum = 0;
    for (const v of series) sum += v;
    return series.length ? sum / series.length : 0;
  });
  loudnessCache.set(s, out);
  return out;
}

/** 每拍（或每拍 n 份）的取樣時間，從第 1 小節起、小於 limit 的全部。 */
export function beatTimes(tempo: TempoMap, limit: number, perBeat: number): number[] {
  const out: number[] = [];
  for (let bar = 1; bar < 100000; bar++) {
    const start = timeOfBar(tempo, bar);
    const end = timeOfBar(tempo, bar + 1);
    if (!(end > start)) break;
    const n = 4 * perBeat;
    for (let i = 0; i < n; i++) {
      const time = start + ((end - start) * i) / n;
      if (time >= limit) return out;
      out.push(time);
    }
  }
  return out;
}

interface Pt {
  x: number;
  y: number;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const { tempo, spectrum, duration } = ctx.readings;
  const gain = paramNum(ctx, params, 'gain');
  const perBeat = Math.max(1, Math.round(paramNum(ctx, params, 'perBeat')));
  const left = w * LEFT;
  const span = w * (RIGHT - LEFT);
  const laneGap = (h * (BOTTOM - TOP)) / BANDS.length;
  const laneY = (i: number) => h * TOP + (i + 0.5) * laneGap;
  const total = duration > 0 ? duration : 1;
  const beat = printedBeat(tempo, t);

  p.background(theme.paper);

  // 泳道中線
  p.noFill();
  p.stroke(theme.line, h * 0.0008);
  for (let i = 0; i < BANDS.length; i++) p.line(left, laneY(i), left + span, laneY(i));

  if (spectrum) {
    const times = beatTimes(tempo, Math.min(t, total), perBeat);
    const loud = laneLoudness(spectrum);
    const loudest = Math.max(1e-6, ...loud);
    const xOf = (time: number) => left + (time / total) * span;

    for (let lane = 0; lane < BANDS.length; lane++) {
      const [lo, hi] = BANDS[lane];
      const series = bandSeries(spectrum, lo, hi);
      const darkness = 0.3 + 0.7 * (loud[lane] / loudest);
      const amp = laneGap * 0.42 * gain;
      const top: Pt[] = [];
      const bottom: Pt[] = [];
      for (let j = 0; j < times.length; j++) {
        const from = times[j];
        const to = j + 1 < times.length ? times[j + 1] : Math.min(t, total);
        const e = Math.min(1, meanOver(series, spectrum.fps, from, Math.max(from, to)));
        const x = xOf(from);
        top.push({ x, y: laneY(lane) - e * amp });
        bottom.push({ x, y: laneY(lane) + e * amp });
      }
      if (top.length === 0) continue;

      // 網：相鄰樣本的上下點交叉連線
      p.noFill();
      for (let j = 0; j + 1 < top.length; j++) {
        const recent = times[j + 1] >= t - beat;
        p.stroke(recent ? theme.accent : theme.ink, h * 0.0004, recent ? 1 : 0.55 * darkness);
        p.line(top[j].x, top[j].y, bottom[j + 1].x, bottom[j + 1].y);
        p.line(bottom[j].x, bottom[j].y, top[j + 1].x, top[j + 1].y);
      }
      // 包絡線
      p.stroke(theme.ink, h * 0.0008, darkness);
      p.polyline(top);
      p.polyline(bottom);
    }
  }

  drawLabel(p, ctx);
}

/** 頻帶織網：六條頻帶六條泳道，每拍一個樣本的包絡交叉織成網，整首最大聲的那條最深。 */
export const meshLook: Look = {
  id: 'mesh',
  number: 10,
  name: '頻帶織網',
  listens: ['spectrum', 'tempo'],
  params,
  draw,
};

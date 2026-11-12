import { binHz, binValue } from '../analysis/audio/spectrum';
import { positionAt, secondsToTicks, ticksToSeconds } from '../analysis/tempo';
import type { Spectrum, TempoMap } from '../analysis/types';
import type { Painter } from './painter/painter';
import { meanOver, paramNum } from './sheet';
import type { Look, LookContext, ParamDef, Readout } from './types';

const params: ParamDef[] = [
  { key: 'rows', label: '列數（8 分音符）', min: 8, max: 24, default: 14 },
];

/** 18 個對數頻帶：40 Hz–16 kHz 等比分段。 */
export const PEG_BANDS = 18;
const LO_HZ = 40;
const HI_HZ = 16000;

/**
 * 每欄的顏色（theme.noteColors 的索引）：照 Oto 海報由低到高一組組相鄰同色，
 * 暗紅 → 橘 → 粉 → 藍 → 淺藍 → 綠 → 橄欖 → 黃。
 */
const GROUPS = [0, 0, 2, 2, 2, 11, 11, 11, 9, 9, 9, 8, 8, 6, 6, 5, 3, 3];
/** 強拍時 peg 中心那顆點的顏色：-1 = 灰（mute），否則是對比色的索引。 */
const PARTNER: Record<number, number> = { 0: -1, 2: -1, 11: 9, 9: 2, 8: 9, 6: 11, 5: 11, 3: -1 };

/** 一欄 peg 的強度門檻：依整首歌該帶的分佈取分位數，所以安靜的高頻也亮得起來。 */
interface BandStats {
  dim: number;
  lit: number;
  mid: number;
  strong: number;
  lo: number;
  hi: number;
}

interface PegData {
  series: Float32Array[];
  /** 每帶每個 8 分音符的平均能量（整首）。 */
  eighths: Float32Array[];
  stats: BandStats[];
}

const seriesCache = new WeakMap<Spectrum, Float32Array[]>();
const cache = new WeakMap<Spectrum, WeakMap<TempoMap, PegData>>();

export function bandEdges(i: number): [number, number] {
  const r = HI_HZ / LO_HZ;
  return [LO_HZ * r ** (i / PEG_BANDS), LO_HZ * r ** ((i + 1) / PEG_BANDS)];
}

function quantile(sorted: Float32Array, q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** 18 帶的逐幀能量；一個 Spectrum 算一次。帶內沒有 bin 就取最近的 bin。 */
function pegSeries(s: Spectrum): Float32Array[] {
  const hit = seriesCache.get(s);
  if (hit) return hit;
  const series: Float32Array[] = [];
  for (let i = 0; i < PEG_BANDS; i++) {
    const [lo, hi] = bandEdges(i);
    let bins: number[] = [];
    for (let b = 0; b < s.bins; b++) {
      const hz = binHz(s, b);
      if (hz >= lo && hz < hi) bins.push(b);
    }
    if (bins.length === 0) {
      const mid = Math.sqrt(lo * hi);
      let best = 0;
      for (let b = 1; b < s.bins; b++)
        if (Math.abs(Math.log(binHz(s, b) / mid)) < Math.abs(Math.log(binHz(s, best) / mid)))
          best = b;
      bins = [best];
    }
    const out = new Float32Array(s.frameCount);
    for (let f = 0; f < s.frameCount; f++) {
      let sum = 0;
      for (const b of bins) sum += binValue(s, f, b);
      out[f] = sum / bins.length;
    }
    series.push(out);
  }
  seriesCache.set(s, series);
  return series;
}

/**
 * 整首歌每個 8 分音符、每帶的平均能量，與依它取的分位數門檻（所以門檻跟格子的
 * 平均方式一致，安靜的高頻也亮得起來）。依 (Spectrum, TempoMap) 快取。
 */
function pegData(s: Spectrum, tempo: TempoMap): PegData {
  let byTempo = cache.get(s);
  if (!byTempo) {
    byTempo = new WeakMap();
    cache.set(s, byTempo);
  }
  const hit = byTempo.get(tempo);
  if (hit) return hit;
  const series = pegSeries(s);
  const count = eighthAt(tempo, s.frameCount / s.fps) + 1;
  const spans: [number, number][] = [];
  for (let e = 0; e < count; e++) spans.push(eighthSpan(tempo, e));
  const eighths: Float32Array[] = [];
  const stats: BandStats[] = [];
  for (const ser of series) {
    const out = new Float32Array(count);
    for (let e = 0; e < count; e++) out[e] = meanOver(ser, s.fps, spans[e][0], spans[e][1]);
    eighths.push(out);
    const sorted = Float32Array.from(out).sort();
    stats.push({
      dim: quantile(sorted, 0.3),
      lit: quantile(sorted, 0.5),
      mid: quantile(sorted, 0.75),
      strong: quantile(sorted, 0.9),
      lo: quantile(sorted, 0.45),
      hi: quantile(sorted, 0.98),
    });
  }
  const data = { series, eighths, stats };
  byTempo.set(tempo, data);
  return data;
}

/** t 所在的 8 分音符序號（從第一拍起算，第一拍之前算 0）。 */
export function eighthAt(tempo: TempoMap, t: number): number {
  return Math.max(0, Math.floor(secondsToTicks(tempo, t) / (tempo.ppq / 2)));
}

/** 第 e 個 8 分音符的 [起, 迄] 秒。 */
function eighthSpan(tempo: TempoMap, e: number): [number, number] {
  const q = tempo.ppq / 2;
  return [ticksToSeconds(tempo, e * q), ticksToSeconds(tempo, (e + 1) * q)];
}

/** 實際列數：參數是下限；高的格子自動多排幾列讓 peg 接近正圓、填滿整個框。 */
export function rowsFor(ctx: LookContext): number {
  const want = Math.round(paramNum(ctx, params, 'rows'));
  const cw = ctx.w / PEG_BANDS;
  const fit = cw > 0 ? Math.floor(ctx.h / cw) : want;
  return Math.max(1, Math.min(48, Math.max(want, fit)));
}

type Level = 0 | 1 | 2 | 3 | 4;

/** 一格的狀態：0 空、1 暗點、2 亮、3 亮 + 灰點、4 強拍（亮 + 環 + 對比點）。 */
function levelOf(v: number, st: BandStats): Level {
  if (v > st.strong) return 4;
  if (v > st.mid) return 3;
  if (v > st.lit) return 2;
  if (v > st.dim) return 1;
  return 0;
}

/** 第 e 個 8 分音符（到 t 為止）在每帶的平均能量。 */
function rowValues(ctx: LookContext, data: PegData, e: number): number[] {
  const s = ctx.readings.spectrum as Spectrum;
  // 已經走完的 8 分音符直接查表；正在走的那一格只算到 t
  if (e < eighthAt(ctx.readings.tempo, ctx.t)) return data.eighths.map((x) => x[e] ?? 0);
  const [a, b] = eighthSpan(ctx.readings.tempo, e);
  const to = Math.min(b, ctx.t);
  return data.series.map((ser) => meanOver(ser, s.fps, a, Math.max(a, to)));
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  p.background(theme.paper);
  p.noStroke();

  const rows = rowsFor(ctx);
  const cw = w / PEG_BANDS;
  const ch = h / rows;
  const cell = Math.min(cw, ch);
  const x0 = (w - cw * PEG_BANDS) / 2;
  const y0 = (h - ch * rows) / 2;
  const peg = cell * 0.94;
  const e = eighthAt(ctx.readings.tempo, t);
  const page = Math.floor(e / rows);
  const k = e % rows;
  const s = ctx.readings.spectrum;
  const data = s ? pegData(s, ctx.readings.tempo) : null;
  const dark = theme.glow;

  for (let r = 0; r < rows; r++) {
    const y = y0 + ch * (rows - 1 - r) + ch / 2;
    // 這一頁已經填到的列；上面還沒填到的列淡淡留著上一頁（像整頁從下往上重寫）
    const current = r <= k;
    const idx = current ? page * rows + r : (page - 1) * rows + r;
    const ghost = current ? 1 : 0.38;
    const vals = data && idx >= 0 && idx <= e ? rowValues(ctx, data, idx) : null;
    for (let i = 0; i < PEG_BANDS; i++) {
      const x = x0 + cw * i + cw / 2;
      const color = theme.noteColors[GROUPS[i]] ?? theme.ink;
      p.fill(theme.line, dark ? 0.75 : 0.55);
      p.circle(x, y, peg);
      if (!vals || !data) continue;
      const st = data.stats[i];
      const v = vals[i];
      const lv = levelOf(v, st);
      if (lv === 0) continue;
      if (lv === 1) {
        p.fill(color, ghost);
        p.circle(x, y, peg * 0.16);
        continue;
      }
      const span = st.hi - st.lo;
      const amt = span > 0 ? Math.max(0, Math.min(1, (v - st.lo) / span)) : 1;
      const d = peg * (0.55 + 0.45 * amt);
      p.fill(color, ghost);
      p.circle(x, y, d);
      if (lv === 3) {
        p.fill(theme.mute, ghost);
        p.circle(x, y, d * 0.2);
      } else if (lv === 4) {
        const partner = PARTNER[GROUPS[i]] ?? -1;
        p.fill(theme.mute, 0.9 * ghost);
        p.circle(x, y, d * 0.52);
        p.fill(partner < 0 ? theme.mute : (theme.noteColors[partner] ?? theme.mute), ghost);
        p.circle(x, y, d * (partner < 0 ? 0.3 : 0.32));
        if (partner < 0) {
          p.fill(theme.ink, 0.55 * ghost);
          p.circle(x, y, d * 0.18);
        }
      }
    }
  }
}

function readouts(ctx: LookContext): Readout[] {
  const { t, readings: r } = ctx;
  const tempo = r.tempo;
  const sig = (tempo.timeSignatures ?? []).filter((x) => x.ticks <= secondsToTicks(tempo, t)).pop();
  const perBar = sig ? Math.max(1, Math.round(sig.numerator * (8 / sig.denominator))) : 8;
  const step = Math.min(perBar, Math.floor(positionAt(tempo, t).barPhase * perBar) + 1);
  let lit = 0;
  if (r.spectrum) {
    const data = pegData(r.spectrum, tempo);
    const vals = rowValues(ctx, data, eighthAt(tempo, t));
    vals.forEach((v, i) => {
      if (levelOf(v, data.stats[i]) >= 2) lit++;
    });
  }
  return [
    { label: 'STEP', value: `${step} / ${perBar}` },
    { label: 'LIT', value: `${lit} of ${PEG_BANDS}` },
    { label: 'ROWS', value: `${rowsFor(ctx)} eighths` },
  ];
}

/** 釘板：18 個頻帶各一欄 peg，一列一個 8 分音符，整頁由下往上填滿再重來。 */
export const pegboardLook: Look = {
  id: 'pegboard',
  number: 27,
  name: '釘板',
  listens: ['spectrum', 'tempo'],
  params,
  draw,
  readouts,
};

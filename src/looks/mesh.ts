import { timeOfBar } from '../analysis/tempo';
import type { Spectrum, TempoMap } from '../analysis/types';
import type { Painter, Point } from './painter/painter';
import { bandSeries, drawLabel, paramNum } from './sheet';
import { accentWindow, geometryCache, penCursor, quantile, wiggle, windowMean } from './sheetPrint';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'gain', label: '寬度', min: 0.5, max: 2, default: 1 },
  { key: 'density', label: '網密度', min: 0.5, max: 2, default: 1 },
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
/** 網眼間距（短邊倍數）。 */
const CELL = 0.011;
/** 每隔幾個網眼，兩條緞帶之間吊一束細線。 */
const FAN_EVERY = 9;

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

interface Ribbon {
  top: Point[];
  bottom: Point[];
  /** 0..1：整首歌這條頻帶有多響（決定墨色深淺）。 */
  loud: number;
}

interface Net {
  ribbons: Ribbon[];
  /** 第 i 個取樣的時間。 */
  times: number[];
}

const netCache = geometryCache<Spectrum, Net>();

/**
 * 整首歌的六條緞帶（快取）：橫向 n 個等距取樣，每個取樣是該時段該頻帶的平均；
 * 厚度以六條一起的 2%..99% 分位數拉開，所以低頻粗、高頻細，跟 Oto 一樣看得出誰最響。
 */
function buildNet(ctx: LookContext, s: Spectrum, gain: number, density: number): Net {
  const { w, h } = ctx;
  const total = ctx.readings.duration > 0 ? ctx.readings.duration : 1;
  const unit = Math.min(w, h);
  const n = Math.max(8, Math.round((w / (unit * CELL)) * density));
  const pitch = h / BANDS.length;
  const amp = pitch * 0.44 * gain;
  const times: number[] = [];
  for (let i = 0; i <= n; i++) times.push((total * i) / n);
  const series = BANDS.map(([lo, hi]) => bandSeries(s, lo, hi));
  let lo = 1;
  let hi = 0;
  for (const se of series) {
    lo = Math.min(lo, quantile(se, 0.02));
    hi = Math.max(hi, quantile(se, 0.99));
  }
  const means = series.map((se) => {
    let sum = 0;
    for (const v of se) sum += v;
    return se.length ? sum / se.length : 0;
  });
  // 依整首平均響度排名：最響的 1、最小聲的 0（頻譜各頻帶的 dB 值很接近，用排名才分得出深淺）
  const rank = means.map((m) => means.filter((o) => o < m).length / Math.max(1, means.length - 1));
  const ribbons = series.map((se, lane) => {
    const mid = (lane + 0.5) * pitch;
    const top: Point[] = [];
    const bottom: Point[] = [];
    for (let i = 0; i <= n; i++) {
      const from = times[Math.max(0, i - 1)];
      const to = times[Math.min(n, i + 1)];
      const v = windowMean(s, se, from, to);
      const e = Math.max(0, Math.min(1, (v - lo) / Math.max(1e-6, hi - lo)));
      const half = Math.max(pitch * 0.05, e * amp * (0.5 + 0.5 * rank[lane]));
      // 網眼不等寬：上下兩緣的結點各自錯開一點，交叉線才會像手織的網，不是規則的鋸齒
      const cell = w / n;
      const xt = i === 0 || i === n ? (w * i) / n : (w * i) / n + wiggle(i * 7 + lane) * cell * 0.3;
      const xb =
        i === 0 || i === n ? (w * i) / n : (w * i) / n + wiggle(i * 13 + lane * 5 + 1) * cell * 0.3;
      top.push({ x: xt, y: mid - half });
      bottom.push({ x: xb, y: mid + half });
    }
    return { top, bottom, loud: rank[lane] };
  });
  return { ribbons, times };
}

/** 交叉網：上下兩條邊以步距 stride 來回連，offset 決定從上邊或下邊起頭。 */
function zigzag(r: Ribbon, from: number, to: number, stride: number, offset: number): Point[] {
  const out: Point[] = [];
  for (let i = from; i <= to; i += stride) {
    const up = ((i - from) / stride + offset) % 2 === 0;
    out.push(up ? r.top[i] : r.bottom[i]);
  }
  return out;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const { tempo, spectrum, duration } = ctx.readings;
  const gain = paramNum(ctx, params, 'gain');
  const density = paramNum(ctx, params, 'density');
  const total = duration > 0 ? duration : 1;
  const unit = Math.min(w, h);
  const printedTo = Math.min(Math.max(0, t), total);
  const pitch = h / BANDS.length;
  const thin = Math.max(0.5, unit * 0.0006);

  p.background(theme.paper);

  if (spectrum) {
    const net = netCache(spectrum, `${w}x${h}:${gain}:${density}:${total}`, () =>
      buildNet(ctx, spectrum, gain, density),
    );
    const n = net.times.length - 1;
    const head = Math.min(n, Math.ceil((printedTo / total) * n));
    const accentFrom = Math.max(
      0,
      Math.min(head - 1, Math.floor(((printedTo - accentWindow(tempo, t) * 2) / total) * n)),
    );

    // 緞帶之間吊的細線：從上一條的下緣收束到縫中間一點，再散到下一條的上緣
    p.noFill();
    p.stroke(theme.mute, thin, 0.3);
    for (let lane = 0; lane + 1 < net.ribbons.length; lane++) {
      const a = net.ribbons[lane];
      const b = net.ribbons[lane + 1];
      for (let i = FAN_EVERY / 2; i + 2 <= accentFrom; i += FAN_EVERY) {
        const c = Math.round(i);
        const fx = a.bottom[c].x;
        const fy = (lane + 1) * pitch;
        const pts: Point[] = [];
        for (let k = -2; k <= 2; k++) {
          const j = Math.max(0, Math.min(n, c + k));
          pts.push(a.bottom[j], { x: fx, y: fy }, b.top[j], { x: fx, y: fy });
        }
        p.polyline(pts);
      }
    }

    for (const r of net.ribbons) {
      const ink = 0.25 + 0.75 * r.loud;
      const end = accentFrom;
      if (end >= 1) {
        // 網：步距 1 的交叉（X 形）兩條，再加步距 2、3 的長斜線，越響越密越黑
        p.stroke(theme.ink, thin, 0.8 * ink);
        p.polyline(zigzag(r, 0, end, 1, 0));
        p.polyline(zigzag(r, 0, end, 1, 1));
        p.stroke(theme.ink, thin, 0.5 * ink);
        p.polyline(zigzag(r, 0, end, 2, 0));
        p.polyline(zigzag(r, 1, end, 2, 1));
        if (r.loud > 0.7) {
          p.polyline(zigzag(r, 0, end, 3, 1));
          p.polyline(zigzag(r, 1, end, 3, 0));
          p.polyline(zigzag(r, 2, end, 3, 1));
        }
        // 網裡糾結的細線：越響的緞帶越多條
        const knots = Math.round(r.loud * 3);
        for (let k = 0; k < knots; k++) {
          const pts: Point[] = [];
          for (let i = 0; i <= end; i += 2) {
            const mid = (r.top[i].y + r.bottom[i].y) / 2;
            const half = (r.bottom[i].y - r.top[i].y) / 2;
            pts.push({ x: r.top[i].x, y: mid + wiggle((i >> 1) * 31 + k * 977) * half * 0.75 });
          }
          p.polyline(pts);
        }
        // 外緣
        p.stroke(theme.ink, thin * 1.6, 0.35 + 0.65 * ink);
        p.polyline(r.top.slice(0, end + 1));
        p.polyline(r.bottom.slice(0, end + 1));
      }
      // 正在織的那一段：強調色
      if (head > end) {
        p.stroke(theme.accent, thin * 1.4);
        p.polyline(zigzag(r, end, head, 1, 0));
        p.polyline(zigzag(r, end, head, 1, 1));
        p.polyline(r.top.slice(end, head + 1));
        p.polyline(r.bottom.slice(end, head + 1));
      }
    }

    if (t < total) {
      const x = net.ribbons[0].top[head].x;
      p.stroke(theme.mute, thin, 0.6);
      p.line(x, 0, x, h);
      penCursor(p, ctx, x, h / 2);
    }
  }

  drawLabel(p, ctx);
}

/** 頻帶織網：六條頻帶六條緞帶，橫跨整張紙由左往右織；厚度是能量，整首最響的那條織得最密最黑。 */
export const meshLook: Look = {
  id: 'mesh',
  number: 10,
  name: '頻帶織網',
  listens: ['spectrum', 'tempo'],
  params,
  draw,
};

import type { Spectrum } from '../analysis/types';
import type { Painter, Point } from './painter/painter';
import { bandSeries, drawLabel, energySeries, paramNum } from './sheet';
import { geometryCache, penCursor, quantile, windowMean } from './sheetPrint';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'gain', label: '射線長度', min: 0.5, max: 1.5, default: 1 },
  { key: 'rays', label: '射線數', min: 120, max: 900, default: 480 },
];

const INNER = 0.17; // 射線起點半徑（短邊倍數）
const OUTER = 0.49; // 最長射線到這裡
const RINGS = [0.86, 0.92, 0.98]; // 內圈三道細環（INNER 的倍數）
/** 每根射線佔角度間距的比例（其餘留白，看得出一根一根）。 */
const RAY_FILL = 0.74;

interface Rays {
  level: Float32Array;
  low: Float32Array;
  high: Float32Array;
}

const raysCache = geometryCache<Spectrum, Rays>();

/** 每根射線那一段時間的音量、低頻佔比、高頻（各以整首歌的分位數拉開到 0..1）。 */
function buildRays(s: Spectrum, total: number, n: number): Rays {
  const energy = energySeries(s);
  const lowS = bandSeries(s, 30, 150);
  const highS = bandSeries(s, 4000, 16000);
  const norm = (se: Float32Array, v: number) => {
    const lo = quantile(se, 0.05);
    const hi = quantile(se, 0.99);
    return Math.max(0, Math.min(1, (v - lo) / Math.max(1e-6, hi - lo)));
  };
  const level = new Float32Array(n);
  const low = new Float32Array(n);
  const high = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const from = (total * i) / n;
    const to = (total * (i + 1)) / n;
    level[i] = norm(energy, windowMean(s, energy, from, to));
    low[i] = norm(lowS, windowMean(s, lowS, from, to));
    high[i] = norm(highS, windowMean(s, highS, from, to));
  }
  return { level, low, high };
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const { spectrum, duration } = ctx.readings;
  const gain = paramNum(ctx, params, 'gain');
  const n = Math.max(12, Math.round(paramNum(ctx, params, 'rays')));
  const cx = w / 2;
  const cy = h / 2;
  const unit = Math.min(w, h);
  const inner = unit * INNER;
  const reach = unit * (OUTER - INNER);
  const total = duration > 0 ? duration : 1;
  const printedTo = Math.min(Math.max(0, t), total);
  const head = Math.min(n, Math.floor((printedTo / total) * n));
  const da = (Math.PI * 2) / n;
  const angleOf = (i: number) => i * da - Math.PI / 2;
  const at = (a: number, r: number): Point => ({
    x: cx + Math.cos(a) * r,
    y: cy + Math.sin(a) * r,
  });

  p.background(theme.paper);

  // 還沒印的扇區：外緣一圈淡淡的刻度環
  p.noFill();
  p.stroke(theme.line, Math.max(0.6, unit * 0.0008));
  p.circle(cx, cy, (inner + reach) * 2);

  if (spectrum) {
    const rays = raysCache(spectrum, `${n}:${total}`, () => buildRays(spectrum, total, n));
    const len = (v: number) => inner + reach * Math.min(1, v * gain);
    // 一層射線 = 一個星形多邊形（每根射線是一個窄扇形），一次 shape 畫完，不用上千次 line
    const layer = (value: (i: number) => number, fill: number, from: number, to: number) => {
      const pts: Point[] = [];
      for (let i = from; i < to; i++) {
        const v = value(i);
        if (v <= 0) continue;
        const a0 = angleOf(i);
        const a1 = a0 + da * fill;
        const r = len(v);
        pts.push(at(a0, inner), at(a0, r), at(a1, r), at(a1, inner));
      }
      if (pts.length >= 3) p.shape(pts);
    };
    const end = Math.max(0, head - 1);
    // 主體長度：音量拉開後再壓一下，大部分射線停在外圈內，最響的才碰到外緣
    const body = (i: number) => 0.1 + 0.78 * (rays.level[i] ?? 0) ** 1.8;
    p.noStroke();
    // 高頻：細長的紫線，壓在最底下、伸得最遠
    p.fill(theme.noteColors[11] ?? theme.ink, 0.8);
    layer(
      (i) => (rays.high[i] > 0.8 ? body(i) + 0.06 + 0.9 * (rays.high[i] - 0.8) : 0),
      0.16,
      0,
      end,
    );
    // 主體：音量，強調色
    p.fill(theme.accent);
    layer(body, RAY_FILL, 0, end);
    // 低頻特別重的地方：金色射線蓋在上面
    p.fill(theme.noteColors[4] ?? theme.ink, 0.9);
    layer((i) => (rays.low[i] > rays.level[i] + 0.12 ? body(i) * 0.94 : 0), RAY_FILL, 0, end);

    // 星形多邊形的內緣弦會蓋到中心；用紙色把內圓蓋回來
    p.fill(theme.paper);
    p.circle(cx, cy, inner * 2);

    // 正在印的那根：墨色，筆頭在尖端
    if (t < total) {
      const v = body(Math.min(n - 1, head));
      const a = angleOf(head);
      const tip = at(a, len(v));
      const root = at(a, inner * 0.8);
      p.noFill();
      if (theme.glow) p.glow(theme.accent, unit * 0.004);
      p.stroke(theme.ink, Math.max(1, unit * 0.0016));
      p.line(root.x, root.y, tip.x, tip.y);
      if (theme.glow) p.noGlow();
      penCursor(p, ctx, tip.x, tip.y);
    }
  }

  // 內圈三道細環
  p.noFill();
  p.stroke(theme.mute, Math.max(0.6, unit * 0.0009), 0.8);
  for (const k of RINGS) p.circle(cx, cy, inner * k * 2);

  drawLabel(p, ctx);
}

/** 日冕：整首歌繞一圈，幾百根射線，長度是那一刻的音量；低頻重的地方金色，高頻是伸出去的細紫線。 */
export const coronaLook: Look = {
  id: 'corona',
  number: 11,
  name: '日冕',
  listens: ['spectrum', 'tempo'],
  params,
  draw,
};

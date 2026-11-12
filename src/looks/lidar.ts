import { frameAt } from '../analysis/audio/spectrum';
import type { Spectrum } from '../analysis/types';
import type { Painter } from './painter/painter';
import { drawLabel, paramNum, printedBeat } from './sheet';
import type { Look, LookContext, ParamDef, Readout } from './types';

const params: ParamDef[] = [
  { key: 'lines', label: '掃描線數', min: 8, max: 48, default: 30 },
  { key: 'dots', label: '每線點數', min: 32, max: 160, default: 126 },
  { key: 'threshold', label: '浮起門檻（百分位）', min: 0.2, max: 0.95, default: 0.6 },
];

const BOTTOM = 0.97;
const TOP = 0.06;
/** 最遠那條線縮到多窄 */
const FAR_SCALE = 0.36;
/** 相鄰兩條掃描線差幾拍 */
const BEATS_PER_LINE = 0.5;
const LO_HZ = 40;
const HI_HZ = 14000;
/** 低於這個 Hz 用墨色、到 MID_HZ 用綠、以上用藍 */
const LOW_HZ = 90;
const MID_HZ = 1200;
/** 絕對的靜音門檻：整首的百分位再低，低於這個也不畫 */
const FLOOR = 0.02;

/** 依百分位快取：每個 bin 在整首歌的第 p 百分位（每 4 幀取一次樣就夠準）。 */
const baseCache = new WeakMap<Spectrum, Map<number, Float32Array>>();
function baseline(s: Spectrum, p: number): Float32Array {
  let m = baseCache.get(s);
  if (!m) {
    m = new Map();
    baseCache.set(s, m);
  }
  const key = Math.round(p * 100);
  const hit = m.get(key);
  if (hit) return hit;
  const out = new Float32Array(s.bins);
  const col = new Float32Array(Math.ceil(s.frameCount / 4));
  for (let b = 0; b < s.bins; b++) {
    let n = 0;
    for (let f = 0; f < s.frameCount; f += 4) col[n++] = s.frames[f * s.bins + b];
    const sorted = col.subarray(0, n).sort();
    out[b] = n ? sorted[Math.min(n - 1, Math.floor(n * p))] : 0;
  }
  m.set(key, out);
  return out;
}

interface Scan {
  /** 每個顏色 × 遠近三層的 x, y, d 平鋪 */
  buckets: number[][];
  lines: number;
  points: number;
}

/** 把一幀頻譜在 [LO_HZ, HI_HZ] 上對數取 dots 個點，bin 之間線性內插。 */
function sample(s: Spectrum, frame: number, u: number): number {
  const hz = LO_HZ * (HI_HZ / LO_HZ) ** u;
  const pos = (Math.log(hz / s.minHz) / Math.log(s.maxHz / s.minHz)) * s.bins - 0.5;
  const b = Math.max(0, Math.min(s.bins - 1, pos));
  const b0 = Math.floor(b);
  const b1 = Math.min(s.bins - 1, b0 + 1);
  const f = b - b0;
  const row = frame * s.bins;
  return s.frames[row + b0] * (1 - f) + s.frames[row + b1] * f;
}

function scan(ctx: LookContext): Scan {
  const { w, h, t } = ctx;
  const s = ctx.readings.spectrum;
  const buckets: number[][] = Array.from({ length: 9 }, () => []);
  if (!s) return { buckets, lines: 0, points: 0 };
  const lines = Math.max(2, Math.round(paramNum(ctx, params, 'lines')));
  const dots = Math.max(2, Math.round(paramNum(ctx, params, 'dots')));
  const base = baseline(s, paramNum(ctx, params, 'threshold'));
  const beat = printedBeat(ctx.readings.tempo, t);
  const unit = Math.min(w, h);
  const cx = w / 2;
  const yOf = (f: number) => h * BOTTOM - (1 - (1 - f) ** 1.6) * h * (BOTTOM - TOP);
  let drawn = 0;
  let points = 0;
  const row = new Float32Array(dots);
  for (let i = 0; i < lines; i++) {
    const time = t - i * BEATS_PER_LINE * beat;
    if (time < 0) break;
    drawn++;
    const f = i / (lines - 1); // 0 最近、1 最遠
    const y = yOf(f);
    const gap = y - yOf(Math.min(1, (i + 1) / (lines - 1)));
    const scale = 1 - (1 - FAR_SCALE) * f;
    // 最近的線比框還寬一點（框外裁掉），像真的貼著地面掃過來
    const span = w * 1.1 * scale;
    const frame = frameAt(s, time);
    // 點徑最多到點距，一段一段的點才連得起來又不糊在一起
    const dotSize = Math.min(unit * 0.012 * (1 - 0.5 * f), (span / dots) * 0.95);
    const depth = f < 0.33 ? 0 : f < 0.66 ? 1 : 2;
    // 先取樣一整條，順便看這一幀偏低頻還是偏高頻：顏色分界跟著移（±1 個八度），邊界才會鋸齒狀地起伏
    let lowSum = 0;
    let highSum = 0;
    for (let j = 0; j < dots; j++) {
      const u = j / (dots - 1);
      const raw = sample(s, frame, u);
      row[j] = raw;
      if (u < 0.5) lowSum += raw;
      else highSum += raw;
    }
    const tilt = Math.max(-1, Math.min(1, ((highSum - lowSum) / Math.max(1, dots / 2)) * 4));
    const lowEdge = LOW_HZ * 2 ** (tilt * 0.6);
    const midEdge = MID_HZ * 2 ** tilt;
    for (let j = 0; j < dots; j++) {
      const u = j / (dots - 1);
      const raw = row[j];
      if (raw < FLOOR) continue;
      const hz = LO_HZ * (HI_HZ / LO_HZ) ** u;
      const pos = (Math.log(hz / s.minHz) / Math.log(s.maxHz / s.minHz)) * s.bins - 0.5;
      const q = base[Math.max(0, Math.min(s.bins - 1, Math.round(pos)))];
      // 比這個 bin 平常響的點浮起一階、很響的浮兩階：一條線斷成高低錯開的幾段
      const level = raw < q ? 0 : raw < q + (1 - q) * 0.3 ? 1 : 2;
      const color = hz < lowEdge ? 0 : hz < midEdge ? 1 : 2;
      buckets[color * 3 + depth].push(
        cx + (u - 0.5) * span,
        y - level * gap * 0.38,
        dotSize * (0.85 + 0.12 * level),
      );
      points++;
    }
  }
  return { buckets, lines: drawn, points };
}

function draw(p: Painter, ctx: LookContext): void {
  const { theme } = ctx;
  const colors = [theme.ink, theme.noteColors[6] ?? theme.ink, theme.noteColors[9] ?? theme.ink];
  const alphas = [1, 0.75, 0.5];
  const sc = scan(ctx);

  p.background(theme.paper);
  p.noStroke();
  for (let c = 0; c < 3; c++) {
    for (let d = 0; d < 3; d++) {
      const b = sc.buckets[c * 3 + d];
      if (b.length === 0) continue;
      p.fill(colors[c], alphas[d]);
      for (let k = 0; k < b.length; k += 3) p.circle(b[k], b[k + 1], b[k + 2]);
    }
  }

  drawLabel(p, ctx);
}

function formatHz(hz: number): string {
  return hz >= 1000 ? `${Math.round(hz / 1000)} kHz` : `${Math.round(hz)} Hz`;
}

function readouts(ctx: LookContext): Readout[] {
  const sc = scan(ctx);
  return [
    { label: 'SCAN LINES', value: String(sc.lines) },
    { label: 'POINTS', value: String(sc.points) },
    { label: 'RANGE', value: `${formatHz(LO_HZ)} – ${formatHz(HI_HZ)}` },
  ];
}

/** 雷達掃描：每半拍一條掃描線，近的在下、往上退成透視；一條線是一幀頻譜（126 點），比平常響的點浮起，低頻墨色、中頻綠、高頻藍。 */
export const lidarLook: Look = {
  id: 'lidar',
  number: 15,
  name: '雷達掃描',
  listens: ['spectrum', 'tempo'],
  params,
  draw,
  readouts,
};

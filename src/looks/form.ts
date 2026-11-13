import { bpmAt } from '../analysis/tempo';
import type { DrumHit, Spectrum } from '../analysis/types';
import type { Painter, Point } from './painter/painter';
import { BANDS7, bandSeries, paramNum, rngFor, smoothAt } from './sheet';
import { geometryCache, labelSize } from './sheetPrint';
import type { Look, LookContext, ParamDef, Readout } from './types';

/**
 * Form：每個 hit 是一個吸引點，點的高斯場疊起來畫成等高線——一團會隨 hit 老去而漂移的「聲形」。
 * 主區分五欄 SUB · LOW · MID · HIGH · AIR：kick 落在左邊兩欄、snare 在中間、hat 在右邊兩欄。
 * 上方四格小圖解釋做法（點 → 場 → 合併 → 形），藍色虛線是最近 10 秒點群重心走過的路。
 */

const params: ParamDef[] = [
  { key: 'points', label: '點數', min: 8, max: 48, default: 24 },
  { key: 'levels', label: '等高線數', min: 4, max: 14, default: 10 },
];

/** 場的格子數（橫向）；縱向依主區長寬比決定。 */
const COLS = 56;
/** 高斯核寬度，以 unit 為單位。 */
const SIGMA = 0.055;
/** 點的重量衰減時間常數（秒）。 */
const DECAY = 8;
/** 新 hit 的重量在幾秒內漲上來。 */
const RISE = 0.2;
/** 藍色虛線回看幾秒。 */
const PATH_SECONDS = 10;
/** 等高線最低／最高的高度（場最大值的比例）。 */
const LEVEL_LO = 0.12;
const LEVEL_HI = 0.9;
/** 主區的五欄。 */
const COLUMNS = ['SUB', 'LOW', 'MID', 'HIGH', 'AIR'];
/** 四格小圖的標題。 */
const STUDIES = ['Hit points', 'Field', 'Merge', 'Sound form'];

export interface Segment {
  a: Point;
  b: Point;
}

/**
 * Marching squares：grid 是 rows × cols 的純量場（row-major，索引 r * cols + c），
 * 回傳 level 等高線的線段，座標以格子為單位（x = col, y = row），邊上線性插值。
 */
export function marchingSquares(
  grid: ArrayLike<number>,
  cols: number,
  rows: number,
  level: number,
): Segment[] {
  const out: Segment[] = [];
  const lerp = (x0: number, y0: number, v0: number, x1: number, y1: number, v1: number): Point => {
    const k = v1 === v0 ? 0.5 : (level - v0) / (v1 - v0);
    return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k };
  };
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < cols; c++) {
      const tl = grid[r * cols + c];
      const tr = grid[r * cols + c + 1];
      const br = grid[(r + 1) * cols + c + 1];
      const bl = grid[(r + 1) * cols + c];
      const code =
        (tl >= level ? 8 : 0) |
        (tr >= level ? 4 : 0) |
        (br >= level ? 2 : 0) |
        (bl >= level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      // 四條邊上的交點：上、右、下、左
      const top = () => lerp(c, r, tl, c + 1, r, tr);
      const right = () => lerp(c + 1, r, tr, c + 1, r + 1, br);
      const bottom = () => lerp(c, r + 1, bl, c + 1, r + 1, br);
      const left = () => lerp(c, r, tl, c, r + 1, bl);
      switch (code) {
        case 1:
        case 14:
          out.push({ a: left(), b: bottom() });
          break;
        case 2:
        case 13:
          out.push({ a: bottom(), b: right() });
          break;
        case 3:
        case 12:
          out.push({ a: left(), b: right() });
          break;
        case 4:
        case 11:
          out.push({ a: top(), b: right() });
          break;
        case 5: {
          // 鞍點：用中心平均值決定怎麼接
          const mid = (tl + tr + br + bl) / 4;
          if (mid >= level) {
            out.push({ a: left(), b: top() }, { a: bottom(), b: right() });
          } else {
            out.push({ a: left(), b: bottom() }, { a: top(), b: right() });
          }
          break;
        }
        case 6:
        case 9:
          out.push({ a: top(), b: bottom() });
          break;
        case 7:
        case 8:
          out.push({ a: left(), b: top() });
          break;
        case 10: {
          const mid = (tl + tr + br + bl) / 4;
          if (mid >= level) {
            out.push({ a: top(), b: right() }, { a: left(), b: bottom() });
          } else {
            out.push({ a: left(), b: top() }, { a: bottom(), b: right() });
          }
          break;
        }
      }
    }
  }
  return out;
}

/** 把線段首尾相接串成折線（端點以 1/1024 格對齊配對）。封閉環會重複第一點收尾。 */
export function joinSegments(segs: Segment[]): Point[][] {
  const key = (p: Point) => Math.round(p.x * 1024) * 1048576 + Math.round(p.y * 1024);
  const byStart = new Map<number, number[]>();
  const byEnd = new Map<number, number[]>();
  const push = (m: Map<number, number[]>, k: number, i: number) => {
    const list = m.get(k);
    if (list) list.push(i);
    else m.set(k, [i]);
  };
  segs.forEach((s, i) => {
    push(byStart, key(s.a), i);
    push(byEnd, key(s.b), i);
  });
  const used = new Uint8Array(segs.length);
  const take = (m: Map<number, number[]>, k: number): number => {
    const list = m.get(k);
    if (!list) return -1;
    while (list.length) {
      const i = list.pop() as number;
      if (!used[i]) return i;
    }
    return -1;
  };
  const out: Point[][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line: Point[] = [segs[i].a, segs[i].b];
    // 往前接
    for (;;) {
      const tail = line[line.length - 1];
      let j = take(byStart, key(tail));
      if (j >= 0) {
        used[j] = 1;
        line.push(segs[j].b);
        continue;
      }
      j = take(byEnd, key(tail));
      if (j >= 0) {
        used[j] = 1;
        line.push(segs[j].a);
        continue;
      }
      break;
    }
    // 往後接
    for (;;) {
      const head = line[0];
      let j = take(byEnd, key(head));
      if (j >= 0) {
        used[j] = 1;
        line.unshift(segs[j].a);
        continue;
      }
      j = take(byStart, key(head));
      if (j >= 0) {
        used[j] = 1;
        line.unshift(segs[j].b);
        continue;
      }
      break;
    }
    out.push(line);
  }
  return out;
}

interface Layout {
  unit: number;
  margin: number;
  /** 上方四格小圖的高度。 */
  strip: number;
  /** 主區（等高線的範圍）。 */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** 標題列與欄名列的 y。 */
  titleY: number;
  labelY: number;
  fs: number;
}

function layoutOf(ctx: LookContext): Layout {
  const { w, h } = ctx;
  const unit = Math.min(w, h);
  const margin = unit * 0.045;
  const fs = labelSize(ctx);
  const strip = h * 0.14;
  const titleY = strip + fs * 1.6;
  const labelY = h - margin - fs * 0.4;
  return {
    unit,
    margin,
    strip,
    x0: margin,
    x1: w - margin,
    y0: titleY + fs * 1.2,
    y1: labelY - fs * 2.6,
    titleY,
    labelY,
    fs,
  };
}

/** 每個 hit 在主區裡的位置（0..1），與它落在哪一欄；整首算一次。 */
interface Place {
  x: number;
  y: number;
}

const placeCache = geometryCache<DrumHit[], Place[]>();

/** hat 在 hit 當下 air 比 presence 響多少（0..1）；沒有頻譜回 -1。 */
function airShare(s: Spectrum | undefined, time: number): number {
  if (!s) return -1;
  const air = smoothAt(bandSeries(s, 10000, 16000), s.fps, time, 0.05);
  const presence = smoothAt(bandSeries(s, 4000, 10000), s.fps, time, 0.05);
  const sum = air + presence;
  return sum > 0 ? air / sum : 0.5;
}

function placesFor(ctx: LookContext): Place[] {
  const drums = ctx.readings.drums;
  const s = ctx.readings.spectrum;
  return placeCache(drums, `${ctx.seed}:${s ? 's' : '-'}`, () =>
    drums.map((d, i) => {
      const rng = rngFor(ctx.seed, i);
      let col: number;
      if (d.kind === 'kick') col = d.velocity > 0.7 ? 0 : 1;
      else if (d.kind === 'snare') col = 2;
      else {
        const share = airShare(s, d.time);
        col = (share < 0 ? rng() : share) > 0.5 ? 4 : 3;
      }
      return {
        x: (col + 0.15 + 0.7 * rng()) / COLUMNS.length,
        y: 0.15 + 0.7 * rng(),
      };
    }),
  );
}

/** 最後一個 time ≤ t 的 hit 索引（二分搜尋），沒有回 -1。 */
function lastHitBefore(drums: DrumHit[], t: number): number {
  let lo = 0;
  let hi = drums.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (drums[mid].time <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

interface FieldPoint {
  i: number;
  x: number;
  y: number;
  weight: number;
}

/** 時刻 t 的吸引點：最近 n 個 hit，位置與重量（力度 × 年齡衰減，最新的在 RISE 秒內漲上來）。 */
export function pointsAt(ctx: LookContext, t: number, n: number): FieldPoint[] {
  const drums = ctx.readings.drums;
  const last = lastHitBefore(drums, t);
  if (last < 0) return [];
  const places = placesFor(ctx);
  const out: FieldPoint[] = [];
  for (let i = Math.max(0, last - n + 1); i <= last; i++) {
    const d = drums[i];
    const age = t - d.time;
    const rise = Math.min(1, age / RISE);
    const weight = d.velocity * Math.exp(-age / DECAY) * rise * (2 - rise);
    const pl = places[i];
    // 老去的點慢慢往下沉
    out.push({ i, x: pl.x, y: pl.y + 0.03 * Math.min(1, age / DECAY), weight });
  }
  return out;
}

/** 落在 [from, to) 秒內的 hit 的重心（位置 0..1，力度加權）；沒有回 null。 */
function centroidBetween(ctx: LookContext, from: number, to: number): Point | null {
  const drums = ctx.readings.drums;
  const last = lastHitBefore(drums, to - 1e-9);
  if (last < 0) return null;
  const places = placesFor(ctx);
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let i = last; i >= 0 && drums[i].time >= from; i--) {
    const w = drums[i].velocity;
    sx += places[i].x * w;
    sy += places[i].y * w;
    sw += w;
  }
  return sw > 0 ? { x: sx / sw, y: sy / sw } : null;
}

/** 點群的加權重心（0..1）；沒有點回 null。 */
function centroid(points: FieldPoint[]): Point | null {
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (const q of points) {
    sx += q.x * q.weight;
    sy += q.y * q.weight;
    sw += q.weight;
  }
  return sw > 0 ? { x: sx / sw, y: sy / sw } : null;
}

/** 沿折線畫虛線。 */
function dashed(p: Painter, pts: Point[], dash: number, gap: number): void {
  let on = true;
  let left = dash;
  for (let i = 0; i + 1 < pts.length; i++) {
    let ax = pts[i].x;
    let ay = pts[i].y;
    const bx = pts[i + 1].x;
    const by = pts[i + 1].y;
    let len = Math.hypot(bx - ax, by - ay);
    if (len === 0) continue;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    while (len > 0) {
      const step = Math.min(left, len);
      const nx = ax + ux * step;
      const ny = ay + uy * step;
      if (on) p.line(ax, ay, nx, ny);
      ax = nx;
      ay = ny;
      len -= step;
      left -= step;
      if (left <= 0) {
        on = !on;
        left = on ? dash : gap;
      }
    }
  }
}

/** #rrggbb 線性插值（跟 Bodies 一樣，把兩個主題色調成中間色）。 */
function mix(a: string, b: string, k: number): string {
  const pa = Number.parseInt(a.slice(1, 7), 16);
  const pb = Number.parseInt(b.slice(1, 7), 16);
  const ch = (shift: number) => {
    const x = (pa >> shift) & 255;
    const y = (pb >> shift) & 255;
    return Math.round(x + (y - x) * k);
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/** 等高線的粉紅：B（紫洋紅）與 C（珊瑚）各一半，調成 Oto 的桃紅。 */
function pinkOf(theme: LookContext['theme']): string {
  const b = theme.noteColors[11];
  const c = theme.noteColors[0];
  return b && c ? mix(b, c, 0.5) : theme.accent;
}

/** 一圈有機的小輪廓（小圖用）。 */
function blob(cx: number, cy: number, r: number, rng: () => number, n = 28): Point[] {
  const h2 = rng() * Math.PI * 2;
  const h3 = rng() * Math.PI * 2;
  const a2 = 0.12 + 0.1 * rng();
  const a3 = 0.08 + 0.08 * rng();
  const out: Point[] = [];
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI * 2;
    const rr = r * (1 + a2 * Math.sin(2 * a + h2) + a3 * Math.sin(3 * a + h3));
    out.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
  }
  return out;
}

/** 上方四格小圖：點 → 場 → 合併 → 形。固定種子，不隨 t 變。 */
function studies(p: Painter, ctx: LookContext, L: Layout, pink: string, blue: string): void {
  const { theme, w } = ctx;
  const pw = (w - L.margin * 2) / STUDIES.length;
  const top = L.margin * 0.8;
  const areaH = L.strip - top - L.fs * 1.8;
  const thin = Math.max(0.6, L.unit * 0.0009);
  const dot = Math.max(1.5, L.unit * 0.004);
  for (let k = 0; k < STUDIES.length; k++) {
    const rng = rngFor(ctx.seed, 9000 + k);
    const px = L.margin + pw * k;
    const cx = px + pw / 2;
    const cy = top + areaH / 2;
    const rx = pw * 0.3;
    const ry = areaH * 0.42;
    // 同一組 12 個點，四格各畫一次處理後的樣子
    const pts: Point[] = [];
    const seedRng = rngFor(ctx.seed, 9100);
    for (let n = 0; n < 12; n++) {
      pts.push({ x: cx + (seedRng() - 0.5) * 2 * rx, y: cy + (seedRng() - 0.5) * 2 * ry });
    }
    if (k === 0) {
      p.noStroke();
      p.fill(blue, 0.9);
      for (const q of pts) p.circle(q.x, q.y, dot);
    } else if (k === 1) {
      for (const q of pts) {
        p.noFill();
        p.stroke(pink, thin, 0.8);
        p.circle(q.x, q.y, dot * 3.2);
        p.noStroke();
        p.fill(pink, 0.9);
        p.circle(q.x, q.y, dot);
      }
    } else if (k === 2) {
      // 由左到右一條虛線把點串起來，點各有一圈，左右兩群各一圈合併的輪廓
      const order = [...pts].sort((a, b) => a.x - b.x);
      p.stroke(blue, thin, 0.5);
      dashed(p, order, dot * 1.1, dot * 1.1);
      const left = order.slice(0, 6);
      const right = order.slice(6);
      const c1 = centroid(left.map((q, i) => ({ i, x: q.x, y: q.y, weight: 1 })));
      const c2 = centroid(right.map((q, i) => ({ i, x: q.x, y: q.y, weight: 1 })));
      p.noFill();
      p.stroke(pink, thin, 0.8);
      if (c1) p.polyline(blob(c1.x, c1.y, rx * 0.42, rng));
      if (c2) p.polyline(blob(c2.x, c2.y, rx * 0.4, rng));
      for (const q of pts) {
        p.noFill();
        p.stroke(pink, thin, 0.7);
        p.circle(q.x, q.y, dot * 2.4);
        p.noStroke();
        p.fill(pink, 0.9);
        p.circle(q.x, q.y, dot);
      }
    } else {
      // 一個包住大部分點的形，加一個小的落單形
      p.noFill();
      p.stroke(pink, thin * 1.6, 0.95);
      p.polyline(blob(cx + rx * 0.1, cy, rx * 0.7, rng, 36));
      p.polyline(blob(cx - rx * 0.75, cy + ry * 0.3, rx * 0.22, rng, 18));
      p.noStroke();
      p.fill(blue, 0.9);
      for (const q of pts) p.circle(q.x, q.y, dot * 0.9);
    }
    p.noStroke();
    p.fill(theme.mute);
    p.text(STUDIES[k], cx, L.strip - L.fs * 0.5, {
      size: L.fs * 0.95,
      font: 'sans',
      align: 'center',
    });
  }
}

function draw(p: Painter, ctx: LookContext): void {
  const { t, theme } = ctx;
  const L = layoutOf(ctx);
  const n = Math.round(paramNum(ctx, params, 'points'));
  const levels = Math.round(paramNum(ctx, params, 'levels'));
  const dark = theme.glow;
  const pink = pinkOf(theme);
  const blue = theme.noteColors[9] ?? theme.accent;
  const mainW = L.x1 - L.x0;
  const mainH = L.y1 - L.y0;
  const thin = Math.max(0.7, L.unit * 0.0012);
  const dash = L.unit * 0.012;

  p.background(theme.paper);

  studies(p, ctx, L, pink, blue);

  // 標題列
  p.noStroke();
  p.fill(theme.ink);
  p.text('SOUND FORM', L.x0, L.titleY, {
    size: L.fs * 1.1,
    font: 'sans',
    align: 'left',
    weight: 700,
  });
  p.fill(theme.ink, 0.85);
  p.text(`♩ = ${Math.round(bpmAt(ctx.readings.tempo, t))}`, L.x1, L.titleY, {
    size: L.fs * 1.05,
    font: 'mono',
    align: 'right',
  });

  // 五欄：虛線分隔與欄名
  const colW = mainW / COLUMNS.length;
  p.stroke(theme.line, Math.max(0.6, L.unit * 0.001), dark ? 1 : 0.9);
  for (let c = 1; c < COLUMNS.length; c++) {
    const x = L.x0 + colW * c;
    dashed(
      p,
      [
        { x, y: L.y0 - L.fs },
        { x, y: L.y1 + L.fs * 1.2 },
      ],
      dash,
      dash * 0.7,
    );
  }
  p.noStroke();
  p.fill(theme.mute);
  for (let c = 0; c < COLUMNS.length; c++) {
    p.text(COLUMNS[c], L.x0 + colW * (c + 0.5), L.labelY, {
      size: L.fs * 0.95,
      font: 'mono',
      align: 'center',
      tracking: 0.2,
    });
  }

  // 右下的註記
  p.fill(theme.ink);
  p.text('FORM FINDING', L.x1, L.y1 + L.fs * 0.2, {
    size: L.fs * 0.9,
    font: 'sans',
    align: 'right',
    weight: 700,
  });
  p.fill(theme.mute);
  p.text('Every hit pulls; the bands hold the form together.', L.x1, L.y1 + L.fs * 1.4, {
    size: L.fs * 0.85,
    font: 'sans',
    align: 'right',
  });

  // 吸引點
  const points = pointsAt(ctx, t, n);
  const toX = (x: number) => L.x0 + x * mainW;
  const toY = (y: number) => L.y0 + y * mainH;

  // 藍色虛線：最近 10 秒，每一秒落下的 hit 各取一個重心，串成重心走過的路
  const path: Point[] = [];
  const now = Math.floor(t);
  for (let k = PATH_SECONDS; k >= 0; k--) {
    const c = centroidBetween(ctx, now - k, k === 0 ? t : now - k + 1);
    if (c) path.push({ x: toX(c.x), y: toY(c.y) });
  }
  if (path.length >= 2) {
    p.noFill();
    p.stroke(blue, thin, 0.5);
    dashed(p, path, dash * 0.8, dash * 0.5);
  }

  if (points.length > 0) {
    // 場：每點一個高斯，只算 3σ 內的格子；格子比主區各邊多出 2σ，最外圈才收得起來
    const sigma = SIGMA * L.unit;
    const pad = sigma * 2;
    const gx = L.x0 - pad;
    const gy = L.y0 - pad;
    const gw = mainW + pad * 2;
    const gh = mainH + pad * 2;
    const cols = COLS;
    const rows = Math.max(16, Math.min(64, Math.round((COLS * gh) / Math.max(1, gw))));
    const grid = new Float32Array(cols * rows);
    const cw = gw / (cols - 1);
    const ch = gh / (rows - 1);
    const inv = 1 / (2 * sigma * sigma);
    const reach = sigma * 3;
    let max = 0;
    for (const q of points) {
      if (q.weight <= 0) continue;
      const px = q.x * mainW + pad;
      const py = q.y * mainH + pad;
      const c0 = Math.max(1, Math.floor((px - reach) / cw));
      const c1 = Math.min(cols - 2, Math.ceil((px + reach) / cw));
      const r0 = Math.max(1, Math.floor((py - reach) / ch));
      const r1 = Math.min(rows - 2, Math.ceil((py + reach) / ch));
      for (let r = r0; r <= r1; r++) {
        const dy = r * ch - py;
        for (let c = c0; c <= c1; c++) {
          const dx = c * cw - px;
          const idx = r * cols + c;
          grid[idx] += q.weight * Math.exp(-(dx * dx + dy * dy) * inv);
          if (grid[idx] > max) max = grid[idx];
        }
      }
    }

    // 內部淡淡的粉：最重的幾個點各一團 haze
    const strongest = [...points].sort((a, b) => b.weight - a.weight).slice(0, 6);
    p.blend(dark ? 'add' : 'multiply');
    for (const q of strongest) {
      p.haze(toX(q.x), toY(q.y), sigma * 2.4, pink, (dark ? 0.08 : 0.06) * (0.5 + 0.5 * q.weight));
    }
    p.blend('normal');

    // 等高線：由低到高等比間隔（低處密、高處疏，每個點都套得到好幾圈），最低的那圈粗一點
    if (max > 0) {
      p.noFill();
      for (let k = 0; k < levels; k++) {
        const frac = LEVEL_LO * (LEVEL_HI / LEVEL_LO) ** (k / Math.max(1, levels - 1));
        const segs = marchingSquares(grid, cols, rows, max * frac);
        if (segs.length === 0) continue;
        const lines = joinSegments(segs);
        const weight = k === 0 ? L.unit * 0.003 : thin;
        const alpha = k === 0 ? 0.95 : 0.35 + (0.5 * k) / Math.max(1, levels - 1);
        p.stroke(pink, weight, alpha);
        for (const line of lines) {
          p.polyline(line.map((q) => ({ x: gx + q.x * cw, y: gy + q.y * ch })));
        }
      }
    }

    // 點本身
    p.noStroke();
    const dot = Math.max(1.5, L.unit * 0.005);
    for (const q of points) {
      p.fill(pink, 0.45 + 0.55 * Math.min(1, q.weight * 1.5));
      p.circle(toX(q.x), toY(q.y), dot);
    }
    const newest = points[points.length - 1];
    p.noFill();
    p.stroke(pink, thin, 0.5 * (1 - Math.min(1, (t - ctx.readings.drums[newest.i].time) / 1)));
    p.circle(toX(newest.x), toY(newest.y), dot * 4);
  }
}

/** 現在最響的 BANDS7 頻帶名（原始能量）。 */
function strongest(s: Spectrum | undefined, t: number): string {
  if (!s) return '—';
  let best = 0;
  let bestV = -1;
  for (let i = 0; i < BANDS7.length; i++) {
    const v = smoothAt(bandSeries(s, BANDS7[i].lo, BANDS7[i].hi), s.fps, t, 0.15);
    if (v > bestV) {
      bestV = v;
      best = i;
    }
  }
  return BANDS7[best].name;
}

function readouts(ctx: LookContext): Readout[] {
  const n = Math.round(paramNum(ctx, params, 'points'));
  const alive = pointsAt(ctx, ctx.t, n).filter((q) => q.weight > 0.05).length;
  return [
    { label: 'POINTS', value: String(alive) },
    { label: 'CONTOURS', value: String(Math.round(paramNum(ctx, params, 'levels'))) },
    { label: 'STRONGEST', value: strongest(ctx.readings.spectrum, ctx.t) },
    { label: 'TEMPO', value: String(Math.round(bpmAt(ctx.readings.tempo, ctx.t))) },
  ];
}

/** Form：hit 當吸引點，場畫成等高線的一團形體；五欄 SUB…AIR，藍虛線是重心的路。 */
export const formLook: Look = {
  id: 'form',
  number: 34,
  name: '聲形等高線',
  listens: ['drums', 'spectrum', 'tempo'],
  params,
  draw,
  readouts,
};

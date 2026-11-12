import type { Painter } from './painter/painter';
import { bandSeries, drawLabel, paramNum, rngFor, smoothAt, ticksAlive } from './sheet';
import type { Look, LookContext, ParamDef, Readout } from './types';

const params: ParamDef[] = [
  { key: 'density', label: '火花密度', min: 0.3, max: 2, default: 1 },
  { key: 'life', label: '壽命秒數', min: 0.6, max: 3, default: 1.6 },
];

/** 連續發射：每秒幾個 tick */
const RATE = 60;
/** 每個 tick 在能量 1 時噴幾顆：兩側（低頻）與中段（高頻） */
const PER_TICK_LOW = 70;
const PER_TICK_HIGH = 40;
/** 每個 kick 甩出幾顆 */
const KICK_SPARKS = 160;
/** 光環中心在 plot 高度的哪裡 */
const RING_Y = 0.8;
/** 火花最高升到 plot 高度的哪裡 */
const CEIL = 0.08;
/** 高度分幾層上色（環邊淡紫 → 藍 → 青 → 綠），每層再分三種透明度 */
const HUES = [10, 9, 8, 7, 6];
const ALPHAS = [0.25, 0.5, 0.85];

interface Field {
  /** 每個 (色層, 透明度) 桶的 x, y, size 平鋪 */
  buckets: number[][];
  count: number;
  low: number;
  high: number;
}

/** 環的幾何：跟 plot 一樣寬（留一點邊），扁成透視的橢圓。 */
function ring(ctx: LookContext) {
  const { w, h } = ctx;
  const rx = w * 0.46;
  const ry = Math.min(rx * 0.085, h * 0.05);
  return { cx: w / 2, cy: h * RING_Y, rx, ry };
}

/**
 * 算出這一幀所有火花，依顏色與透明度分桶（同一桶一次 fill，避免每顆切換顏色）。
 * 每顆火花是 (tick, 序號) 的函式：出生位置、速度都由 rngFor 決定，位置 = 年齡的函式，沒有狀態。
 */
function sparkField(ctx: LookContext): Field {
  // 同一幀 draw 跟 readouts 都要它：只記最後一組輸入，輸入一樣就直接回上次的結果
  const key = [
    ctx.t,
    ctx.w,
    ctx.h,
    ctx.seed,
    ...params.map((d) => paramNum(ctx, params, d.key)),
  ].join('|');
  if (memo && memo.readings === ctx.readings && memo.key === key) return memo.field;
  const field = computeField(ctx);
  memo = { readings: ctx.readings, key, field };
  return field;
}

let memo: { readings: LookContext['readings']; key: string; field: Field } | null = null;

function computeField(ctx: LookContext): Field {
  const { h, t } = ctx;
  const s = ctx.readings.spectrum;
  const density = paramNum(ctx, params, 'density');
  const life = paramNum(ctx, params, 'life');
  const { cx, cy, rx, ry } = ring(ctx);
  const rise = h * (RING_Y - CEIL);
  const buckets: number[][] = HUES.flatMap(() => ALPHAS.map(() => [] as number[]));
  let count = 0;
  const unit = Math.min(ctx.w, h);
  const put = (
    x: number,
    y: number,
    age: number,
    lifeK: number,
    size: number,
    dither: number,
    boost = 0,
  ) => {
    // 顏色看升起的高度（加一點抖動，色層之間才不會有硬邊），透明度看剩下的壽命
    const up = (cy - y) / rise + (dither - 0.5) * 0.3;
    const hue = Math.max(0, Math.min(HUES.length - 1, Math.floor(up * HUES.length * 1.1)));
    const fade = 1 - age / lifeK;
    const a = Math.min(ALPHAS.length - 1, Math.floor(fade * 2.2 + boost));
    if (fade <= 0) return;
    buckets[hue * ALPHAS.length + a].push(x, y, size);
    count++;
  };

  let lowNow = 0;
  let highNow = 0;
  if (s) {
    const low = bandSeries(s, 30, 250);
    const high = bandSeries(s, 2000, 16000);
    lowNow = smoothAt(low, s.fps, t, 0.1);
    highNow = smoothAt(high, s.fps, t, 0.1);
    const [first, last] = ticksAlive(t, RATE, life);
    for (let k = first; k <= last; k++) {
      const tk = k / RATE;
      const age = t - tk;
      if (age < 0) continue;
      const rng = rngFor(ctx.seed, k);
      const e1 = smoothAt(low, s.fps, tk, 0.06);
      const e2 = smoothAt(high, s.fps, tk, 0.06);
      const nLow = Math.floor(e1 * e1 * PER_TICK_LOW * 1.6 * density);
      const nHigh = Math.floor(e2 * PER_TICK_HIGH * 1.4 * density);
      // 兩側：環的左右兩端（θ 靠近 0 或 π），從側面看就是一道光柱
      for (let i = 0; i < nLow; i++) {
        // 亂數一律先抽完，才不會因為某顆熄了而讓同一 tick 後面的火花跳位
        const th = (rng() < 0.5 ? 0 : Math.PI) + (rng() - 0.5) * (rng() < 0.6 ? 1.2 : 2.4);
        const lk = life * (0.55 + 0.45 * rng());
        const v = 0.55 + 0.6 * rng() * (0.5 + e1);
        const jx = (rng() - 0.5) * unit * 0.05;
        const size = unit * (0.0022 + 0.0018 * rng());
        const d = rng();
        if (age > lk) continue;
        const u = age / lk;
        // 越往上越散開一點，光柱上寬下窄
        const x = cx + Math.cos(th) * rx * (1 - 0.06 * u) + jx * (0.4 + u);
        const y = cy + Math.sin(th) * ry - rise * v * (u - 0.35 * u * u);
        put(x, y, age, lk, size, d);
      }
      // 中段：環的前後（θ 靠近 ±π/2），較矮、較散的一片光幕
      for (let i = 0; i < nHigh; i++) {
        const th = (rng() < 0.5 ? 0.5 : 1.5) * Math.PI + (rng() - 0.5) * 2.2;
        const lk = life * (0.4 + 0.5 * rng());
        const v = 0.3 + 0.5 * rng();
        const jx = (rng() - 0.5) * unit * 0.03;
        const size = unit * (0.0018 + 0.0016 * rng());
        const d = rng();
        if (age > lk) continue;
        const u = age / lk;
        const x = cx + Math.cos(th) * rx + jx * (0.5 + u);
        const y = cy + Math.sin(th) * ry - rise * v * (u - 0.3 * u * u);
        put(x, y, age, lk, size, d);
      }
    }
  }

  // 每個 kick 從環上甩出一圈火花：往外往上，受重力落下
  const kickLife = life * 0.9;
  for (let i = 0; i < ctx.readings.drums.length; i++) {
    const hit = ctx.readings.drums[i];
    if (hit.time > t) break;
    if (hit.kind !== 'kick') continue;
    const age = t - hit.time;
    if (age > kickLife) continue;
    const rng = rngFor(ctx.seed ^ 0x5bd1e995, i);
    const n = Math.floor(KICK_SPARKS * density * (0.4 + 0.6 * hit.velocity));
    const u = age / kickLife;
    for (let j = 0; j < n; j++) {
      const th = rng() * Math.PI * 2;
      const out = 0.06 + 0.12 * rng();
      const up = (0.35 + 0.5 * rng()) * hit.velocity;
      const d = rng();
      const x = cx + Math.cos(th) * rx * (1 + out * u * 2);
      const y = cy + Math.sin(th) * ry * (1 + out * u * 2) - rise * (up * u * 1.6 - 1.1 * u * u);
      if (y > cy + ry * 1.5) continue;
      put(x, y, age, kickLife, unit * 0.003, d, 1);
    }
  }
  return { buckets, count, low: lowNow, high: highNow };
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, theme } = ctx;
  const dark = theme.glow;
  const { cx, cy, rx, ry } = ring(ctx);
  const field = sparkField(ctx);
  const unit = Math.min(w, h);
  const color = (i: number) => theme.noteColors[i] ?? theme.ink;

  p.background(theme.paper);
  p.noStroke();

  // 光柱：兩側的色暈跟著低頻、中間跟著高頻，一路往上疊幾層淡出
  p.blend(dark ? 'add' : 'multiply');
  const k = dark ? 1.3 : 0.35;
  const pillarR = unit * 0.2;
  for (let i = 0; i < 6; i++) {
    const f = i / 5;
    const y = cy - pillarR * 0.6 - f * h * (RING_Y - CEIL) * 0.8;
    const a = k * (0.07 + 0.25 * field.low) * (1 - 0.7 * f);
    const c = color(HUES[Math.min(HUES.length - 1, Math.floor(f * HUES.length))]);
    p.haze(cx - rx * 0.92, y, pillarR * (1 + f * 0.6), c, a);
    p.haze(cx + rx * 0.92, y, pillarR * (1 + f * 0.6), c, a);
    p.haze(cx, y - h * 0.05, rx * (0.7 + f * 0.3), c, k * (0.03 + 0.1 * field.high) * (1 - f));
  }
  // 環上方的一圈光
  if (dark) p.haze(cx, cy - ry, rx * 1.05, color(10), 0.14);

  // 火花：小方塊，同桶一次換色；黑底用相加讓密的地方自然發亮
  p.blend(dark ? 'add' : 'normal');
  for (let hue = 0; hue < HUES.length; hue++) {
    for (let a = 0; a < ALPHAS.length; a++) {
      const b = field.buckets[hue * ALPHAS.length + a];
      if (b.length === 0) continue;
      p.fill(color(HUES[hue]), ALPHAS[a] * (dark ? 1 : 0.8));
      for (let j = 0; j < b.length; j += 3) {
        const s = b[j + 2];
        p.rect(b[j] - s / 2, b[j + 1] - s, s, s * 2);
      }
    }
  }

  // 光環：一條細亮線，加上沿環撒的細碎亮點
  p.blend(dark ? 'add' : 'normal');
  p.noFill();
  p.stroke(theme.ink, unit * 0.0016, dark ? 0.55 : 0.6);
  p.ellipse(cx, cy, rx * 2, ry * 2);
  p.noStroke();
  p.fill(theme.ink, dark ? 0.7 : 0.55);
  const rng = rngFor(ctx.seed ^ 0x27d4eb2f, 0);
  const dot = unit * 0.0024;
  for (let i = 0; i < 1300; i++) {
    const th = rng() * Math.PI * 2;
    const j = 1 + (rng() - 0.5) * 0.05 * (1 + rng() * 2);
    p.rect(cx + Math.cos(th) * rx * j, cy + Math.sin(th) * ry * j, dot, dot);
  }
  p.blend('normal');

  drawLabel(p, ctx);
}

function readouts(ctx: LookContext): Readout[] {
  const f = sparkField(ctx);
  return [
    { label: 'SPARKS', value: String(f.count) },
    { label: 'SIDES · LOWS', value: `${Math.round(f.low * 100)} %` },
    { label: 'MIDDLE · HIGHS', value: `${Math.round(f.high * 100)} %` },
  ];
}

/** 噴泉：頻譜從一圈光環升起成光；兩側光柱是低頻、中段光幕是高頻，kick 從環上甩出火花。火花的位置是年齡的函式，沒有狀態。 */
export const fountainLook: Look = {
  id: 'fountain',
  number: 19,
  name: '噴泉',
  listens: ['spectrum', 'drums'],
  params,
  draw,
  readouts,
};

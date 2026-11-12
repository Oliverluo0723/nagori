import { positionAt, timeOfBar } from '../analysis/tempo';
import type { DrumHit, TempoMap } from '../analysis/types';
import type { Painter } from './painter/painter';
import { formatTime, paramNum } from './sheet';
import type { Look, LookContext, ParamDef, Readout } from './types';

/**
 * Sheet·Rings：整首歌印成一張。時間軸照小節折成幾行（像 Sheet 系把歌排成一列一列），
 * 每個鼓點在它那一小節的位置落下一個半透明圓圈，越疊越密；大小看種類與力度。
 * 黑底用光相加（藍色越疊越亮），紙感用墨色相乘（越疊越深）。剛落下的那一下最亮。
 */

const params: ParamDef[] = [
  { key: 'rows', label: '行數（0 = 自動）', min: 0, max: 12, default: 0 },
  { key: 'size', label: '圈大小', min: 0.5, max: 1.6, default: 1 },
];

/** 剛落下的圈長到全尺寸的秒數。 */
const DROP_SECONDS = 0.35;
/** 「現在」那一下的強調環擴散秒數。 */
const PULSE_SECONDS = 0.6;
/** 藍色：theme.noteColors 的 A。 */
const RING_COLOR = 9;

/** 每個 hit 在小節格上的位置（0 起算的小節 + 小節內相位）。依 drums 陣列與 tempo 物件快取。 */
const posCache = new WeakMap<DrumHit[], WeakMap<TempoMap, Float64Array>>();

export function hitBarPositions(drums: DrumHit[], tempo: TempoMap): Float64Array {
  let perTempo = posCache.get(drums);
  if (!perTempo) {
    perTempo = new WeakMap();
    posCache.set(drums, perTempo);
  }
  const hit = perTempo.get(tempo);
  if (hit) return hit;
  const out = new Float64Array(drums.length);
  for (let i = 0; i < drums.length; i++) {
    const pos = positionAt(tempo, drums[i].time);
    out[i] = pos.bar - 1 + pos.barPhase;
  }
  perTempo.set(tempo, out);
  return out;
}

export interface RingsLayout {
  rows: number;
  barsPerRow: number;
  rowH: number;
  x0: number;
  x1: number;
  spacing: number;
  rowY: (row: number) => number;
}

/**
 * 版面：bars 個小節折成 rows 行，每行塞滿整個寬度。
 * 自動行數讓「一小節的寬」大約是行高的五分之一，高的 9:16 框會折成六行左右、寬框兩三行。
 */
export function ringsLayout(w: number, h: number, bars: number, rowsParam = 0): RingsLayout {
  const n = Math.max(1, bars);
  const auto = Math.round(Math.sqrt((0.2 * h * n) / Math.max(1, w)));
  const rows = Math.max(1, Math.min(n, rowsParam > 0 ? Math.round(rowsParam) : auto, 12));
  const barsPerRow = Math.ceil(n / rows);
  const rowH = h / rows;
  const pad = Math.min(w * 0.12, rowH * 0.3);
  const x0 = pad;
  const x1 = w - pad;
  return {
    rows,
    barsPerRow,
    rowH,
    x0,
    x1,
    spacing: (x1 - x0) / barsPerRow,
    rowY: (row) => rowH * (row + 0.5),
  };
}

/** 圈的半徑（行高的比例）：kick 最大、snare 中、hat 小，力度再放大。 */
export function ringRadius(kind: DrumHit['kind'], velocity: number): number {
  const v = Math.max(0, Math.min(1, velocity));
  if (kind === 'kick') return 0.22 + 0.2 * v;
  if (kind === 'snare') return 0.13 + 0.12 * v;
  return 0.04 + 0.05 * v;
}

/** (seed, k) → 0..1 的固定雜湊；每幀幾千個圈，不想每個都建一個亂數產生器。 */
function hash01(seed: number, k: number): number {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(k + 1, 0xc2b2ae35);
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function totalBars(ctx: LookContext): number {
  const { tempo, duration } = ctx.readings;
  const end = positionAt(tempo, Math.max(0, duration));
  return end.bar - (end.barPhase === 0 && end.beat === 1 ? 1 : 0);
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const { drums, tempo } = ctx.readings;
  const size = paramNum(ctx, params, 'size');
  const L = ringsLayout(w, h, totalBars(ctx), paramNum(ctx, params, 'rows'));
  const pos = hitBarPositions(drums, tempo);
  const blue = theme.noteColors[RING_COLOR] ?? theme.ink;
  const unit = Math.min(w, h);
  const place = (barPos: number) => {
    const bar = Math.floor(barPos);
    const row = Math.min(L.rows - 1, Math.floor(bar / L.barsPerRow));
    const col = bar - row * L.barsPerRow;
    // 同一小節的圈大致同心，小節內的位置只讓圓心稍微左右錯開，疊成一落一落
    const phase = barPos - bar;
    return { x: L.x0 + (col + 0.5 + (phase - 0.5) * 0.35) * L.spacing, y: L.rowY(row) };
  };

  // 已印到哪裡：最後一個 time <= t 的 hit（drums 依時間排序）
  let printed = 0;
  while (printed < drums.length && drums[printed].time <= t) printed++;
  const penBar = positionAt(tempo, Math.max(0, t));
  const pen = place(penBar.bar - 1 + penBar.barPhase);
  const penRow = Math.min(L.rows - 1, Math.floor((penBar.bar - 1) / L.barsPerRow));

  p.background(theme.paper);

  // 時間軸：每行一條，已印的那段用藍、還沒印的用淡線
  p.noFill();
  for (let r = 0; r < L.rows; r++) {
    const y = L.rowY(r);
    p.stroke(theme.line, unit * 0.0012);
    p.line(L.x0 - L.spacing * 0.5, y, L.x1 + L.spacing * 0.5, y);
    const done = r < penRow ? L.x1 : r === penRow ? Math.min(L.x1, pen.x) : L.x0;
    if (done > L.x0) {
      p.stroke(blue, unit * 0.0016, 0.55);
      p.line(L.x0 - L.spacing * 0.5, y, done, y);
    }
  }

  // 每小節一團淡藍色暈：越多 kick / snare 越濃（印好的那幾小節才有）
  p.blend(theme.glow ? 'add' : 'multiply');
  let i = 0;
  while (i < printed) {
    const bar = Math.floor(pos[i]);
    let weight = 0;
    let j = i;
    while (j < printed && Math.floor(pos[j]) === bar) {
      if (drums[j].kind !== 'hat') weight += drums[j].velocity;
      j++;
    }
    if (weight > 0) {
      const c = place(bar + 0.5);
      p.haze(
        c.x,
        c.y,
        L.rowH * 0.5 * size,
        blue,
        Math.min(theme.glow ? 0.3 : 0.24, (theme.glow ? 0.04 : 0.06) + 0.035 * weight),
      );
    }
    i = j;
  }

  // 圈：每個 hit 一個，半透明疊在一起
  p.noFill();
  const weightOf = { kick: 0.0024, snare: 0.0017, hat: 0.0011 };
  for (let k = 0; k < printed; k++) {
    const hit = drums[k];
    const age = t - hit.time;
    const grow = age < DROP_SECONDS ? 1 - (1 - age / DROP_SECONDS) ** 3 : 1;
    // 大小有固定種子的起伏，小節頭（downbeat）那一下再大一圈，疊起來才有層次
    const jitter = 0.75 + 0.5 * hash01(ctx.seed, k) * hash01(ctx.seed + 7, k);
    const phase = pos[k] - Math.floor(pos[k]);
    const downbeat = phase < 0.04 || phase > 0.98 ? 1.2 : 1;
    const r = ringRadius(hit.kind, hit.velocity) * L.rowH * size * jitter * downbeat * grow;
    const c = place(pos[k]);
    const alpha = (theme.glow ? 0.32 : 0.4) * (0.6 + 0.4 * hit.velocity);
    p.stroke(blue, unit * weightOf[hit.kind], alpha);
    p.circle(c.x, c.y, r * 2);
  }
  p.blend('normal');

  // 每小節有 kick 的地方一顆圓心：紙色的洞加藍邊（像 Oto 那一顆顆的珠子）
  let lastBar = -1;
  for (let k = 0; k < printed; k++) {
    const bar = Math.floor(pos[k]);
    if (bar === lastBar || drums[k].kind !== 'kick') continue;
    lastBar = bar;
    const c = place(bar + 0.5);
    p.fill(theme.paper, 0.85);
    p.stroke(blue, unit * 0.0016, 0.9);
    p.circle(c.x, c.y, L.rowH * 0.11 * size);
  }

  // 每行開頭的時間
  p.noStroke();
  p.fill(theme.mute);
  for (let r = 0; r < L.rows; r++) {
    const start = timeOfBar(tempo, r * L.barsPerRow + 1);
    p.text(formatTime(start), L.x0 - L.spacing * 0.5, L.rowY(r) - L.rowH * 0.42, {
      size: Math.max(9, unit * 0.016),
      font: 'mono',
      align: 'left',
    });
  }

  // 剛落下的那一下：亮的實心核 + 擴散的強調色環
  if (printed > 0) {
    const k = printed - 1;
    const hit = drums[k];
    const age = t - hit.time;
    const c = place(pos[k]);
    const r = ringRadius(hit.kind, hit.velocity) * L.rowH * size;
    const fresh = Math.max(0, 1 - age / PULSE_SECONDS);
    if (fresh > 0) {
      p.noFill();
      p.stroke(theme.accent, unit * 0.003, fresh);
      p.circle(c.x, c.y, r * 2 * (1 + 0.35 * (1 - fresh)));
    }
    p.stroke(blue, unit * 0.002);
    p.fill(theme.glow ? theme.ink : theme.paper);
    if (theme.glow) p.glow(blue, unit * 0.03);
    p.circle(c.x, c.y, L.rowH * 0.13 * size);
    if (theme.glow) p.noGlow();
    p.noStroke();
    p.fill(theme.accent);
    p.circle(c.x, c.y, L.rowH * 0.025 * size);
  }
}

function readouts(ctx: LookContext): Readout[] {
  const { t, readings: r } = ctx;
  const printed = r.duration > 0 ? Math.min(1, Math.max(0, t / r.duration)) : 0;
  return [
    { label: 'PRINTED', value: `${Math.round(printed * 100)} %` },
    { label: 'PEN', value: 'Rings' },
    { label: 'TIME', value: formatTime(t) },
  ];
}

/** Hit 圓環：整首歌的鼓點印成一行行時間軸，每一下落一個圈。 */
export const ringsLook: Look = {
  id: 'rings',
  number: 6,
  name: 'Hit 圓環',
  listens: ['drums', 'tempo'],
  params,
  draw,
  readouts,
};

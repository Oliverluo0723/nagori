import { positionAt, timeOfBar } from '../analysis/tempo';
import type { DrumHit } from '../analysis/types';
import type { Painter, Point } from './painter/painter';
import { hitBarPositions } from './rings';
import { paramNum, rngFor, softDot } from './sheet';
import type { Look, LookContext, ParamDef, Readout } from './types';

/**
 * Ink：幾小節一張紙。kick 噴成一團群青光斑（中心亮、周圍一圈細小的飛沫），
 * snare 畫成手繪的不規則墨環（一邊拖著幾根毛），hat 是一粒斑點。
 * 每個 hit 落在它那一小節的那一列、小節內的位置決定左右，再帶固定種子的散落；翻頁就清空。
 */

const params: ParamDef[] = [{ key: 'bars', label: '每頁小節數', min: 4, max: 16, default: 8 }];

/** 群青：theme.noteColors 的 A。 */
const SPOT_COLOR = 9;
/** 墨環：theme.noteColors 的 A♯（偏紫的藍）。 */
const RING_COLOR = 10;
/** 光斑長到全尺寸的秒數。 */
const GROW_SECONDS = 0.25;
/** 版面留白（寬高比例）。 */
const MARGIN = 0.08;

interface Page {
  /** 這一頁的第一與最後一小節（1 起算）。 */
  firstBar: number;
  lastBar: number;
  bars: number;
  /** drums 裡屬於這一頁且 time <= t 的索引範圍 [from, to)。 */
  from: number;
  to: number;
}

function lowerBound(drums: DrumHit[], time: number): number {
  let lo = 0;
  let hi = drums.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (drums[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** t 所在的那一頁，以及已經落下的 hit 範圍。 */
export function pageAt(ctx: LookContext): Page {
  const { tempo, drums } = ctx.readings;
  const bars = Math.max(1, Math.round(paramNum(ctx, params, 'bars')));
  const pos = positionAt(tempo, Math.max(0, ctx.t));
  const page = Math.floor((pos.bar - 1) / bars);
  const firstBar = page * bars + 1;
  const start = timeOfBar(tempo, firstBar);
  const end = timeOfBar(tempo, firstBar + bars);
  const from = lowerBound(drums, start);
  let to = from;
  while (to < drums.length && drums[to].time < end && drums[to].time <= ctx.t) to++;
  return { firstBar, lastBar: firstBar + bars - 1, bars, from, to };
}

/** 一個 hit 的落點與種子：小節列 × 小節內位置，再散開；光斑整顆留在紙內。 */
function place(
  ctx: LookContext,
  page: Page,
  i: number,
  barPos: number,
  radius: number,
): { x: number; y: number; rng: () => number } {
  const { w, h } = ctx;
  const rng = rngFor(ctx.seed, i);
  const mx = w * MARGIN;
  const my = h * MARGIN;
  const usableW = w - 2 * mx;
  const usableH = h - 2 * my;
  const rowH = usableH / page.bars;
  const bar = Math.floor(barPos);
  const phase = barPos - bar;
  const rowIndex = Math.max(0, Math.min(page.bars - 1, bar - (page.firstBar - 1)));
  let x = mx + phase * usableW + (rng() - 0.5) * 0.36 * w;
  let y = my + (rowIndex + 0.5) * rowH + (rng() - 0.5) * 0.9 * rowH;
  x = Math.max(radius, Math.min(w - radius, x));
  y = Math.max(radius, Math.min(h - radius, y));
  return { x, y, rng };
}

function spotRadius(unit: number, velocity: number): number {
  return unit * (0.09 + 0.07 * Math.max(0, Math.min(1, velocity)));
}

function ringRadius(unit: number, velocity: number): number {
  return unit * (0.055 + 0.025 * Math.max(0, Math.min(1, velocity)));
}

function drawSpot(p: Painter, ctx: LookContext, page: Page, i: number, barPos: number): void {
  const { theme, t } = ctx;
  const hit = ctx.readings.drums[i];
  const unit = Math.min(ctx.w, ctx.h);
  const r = spotRadius(unit, hit.velocity);
  const { x, y, rng } = place(ctx, page, i, barPos, r);
  const blue = theme.noteColors[SPOT_COLOR] ?? theme.ink;
  const age = Math.max(0, t - hit.time);
  const grow = age < GROW_SECONDS ? 1 - (1 - age / GROW_SECONDS) ** 2 : 1;
  const scale = 0.6 + 0.4 * grow;

  p.haze(x, y, r * scale, blue, 0.75);
  // 黑底：中心一點亮白；紙感：墨相乘下群青本身就是最深的，不用再加核
  if (theme.glow) p.haze(x, y, r * 0.35 * scale, theme.ink, 0.55);

  // 飛沫：一圈細小的點，散在 1.0–1.9 個半徑外
  const n = 40 + Math.floor(rng() * 31);
  p.noStroke();
  p.fill(theme.glow ? theme.ink : blue, 0.5);
  const d = Math.max(1, unit * 0.003);
  for (let k = 0; k < n; k++) {
    const a = rng() * Math.PI * 2;
    const dist = r * (1 + 0.9 * rng());
    p.circle(x + Math.cos(a) * dist, y + Math.sin(a) * dist, d);
  }
}

function drawRing(p: Painter, ctx: LookContext, page: Page, i: number, barPos: number): void {
  const { theme } = ctx;
  const hit = ctx.readings.drums[i];
  const unit = Math.min(ctx.w, ctx.h);
  const R = ringRadius(unit, hit.velocity);
  const { x, y, rng } = place(ctx, page, i, barPos, R * 1.3);
  const violet = theme.noteColors[RING_COLOR] ?? theme.ink;

  // 手繪的不規則多邊形：10–13 個頂點，半徑各自 ±18%
  const n = 10 + Math.floor(rng() * 4);
  const pts: Point[] = [];
  const spin = rng() * Math.PI * 2;
  for (let k = 0; k < n; k++) {
    const a = spin + (k / n) * Math.PI * 2;
    const rr = R * (1 + (rng() - 0.5) * 0.36);
    pts.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr });
  }
  p.fill(violet, 0.15);
  p.stroke(violet, Math.max(1, unit * 0.0025), 0.9);
  p.shape(pts);

  // 一邊拖出 5–9 根毛，從同一條邊扇出去
  const edge = Math.floor(rng() * n);
  const a = pts[edge];
  const b = pts[(edge + 1) % n];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const out = Math.atan2(mid.y - y, mid.x - x);
  const hairs = 5 + Math.floor(rng() * 5);
  p.noFill();
  p.stroke(violet, Math.max(0.8, unit * 0.0012), 0.7);
  for (let k = 0; k < hairs; k++) {
    const u = rng();
    const sx = a.x + (b.x - a.x) * u;
    const sy = a.y + (b.y - a.y) * u;
    const ang = out + (rng() - 0.5) * 1.0;
    const len = R * 0.3 * (0.6 + 0.8 * rng());
    p.line(sx, sy, sx + Math.cos(ang) * len, sy + Math.sin(ang) * len);
  }
}

function drawSpeck(p: Painter, ctx: LookContext, page: Page, i: number, barPos: number): void {
  const { theme } = ctx;
  const unit = Math.min(ctx.w, ctx.h);
  const d = Math.max(1.5, unit * 0.006);
  const { x, y } = place(ctx, page, i, barPos, d);
  p.noStroke();
  softDot(p, theme, x, y, d, theme.glow ? theme.mute : theme.ink, 0.6);
}

function draw(p: Painter, ctx: LookContext): void {
  const { theme } = ctx;
  const { drums, tempo } = ctx.readings;
  const page = pageAt(ctx);
  const pos = hitBarPositions(drums, tempo);

  p.background(theme.paper);
  p.blend(theme.glow ? 'add' : 'multiply');

  // 先噴光斑、再畫墨環、最後斑點：環與點壓在光斑上面
  for (let i = page.from; i < page.to; i++)
    if (drums[i].kind === 'kick') drawSpot(p, ctx, page, i, pos[i]);
  if (theme.glow) p.blend('normal');
  for (let i = page.from; i < page.to; i++)
    if (drums[i].kind === 'snare') drawRing(p, ctx, page, i, pos[i]);
  for (let i = page.from; i < page.to; i++)
    if (drums[i].kind === 'hat') drawSpeck(p, ctx, page, i, pos[i]);
  p.blend('normal');
}

function readouts(ctx: LookContext): Readout[] {
  const page = pageAt(ctx);
  const { drums } = ctx.readings;
  const count = { kick: 0, snare: 0, hat: 0 };
  for (let i = page.from; i < page.to; i++) count[drums[i].kind]++;
  return [
    { label: 'SHEET', value: `bars ${page.firstBar}–${page.lastBar}` },
    { label: 'SPOTS · KICKS', value: String(count.kick) },
    { label: 'RINGS · SNARES', value: String(count.snare) },
    { label: 'SPECKS · HATS', value: String(count.hat) },
  ];
}

/** Ink：八小節一張，kick 是群青噴霧光點、snare 是毛邊墨環、hat 是斑點。 */
export const inkLook: Look = {
  id: 'ink',
  number: 32,
  name: '墨噴',
  listens: ['drums', 'tempo'],
  params,
  draw,
  readouts,
};

import { positionAt, timeOfBar } from '../analysis/tempo';
import type { DrumHit } from '../analysis/types';
import type { Painter } from './painter/painter';
import { paramNum } from './sheet';
import type { Look, LookContext, ParamDef, Readout } from './types';

const params: ParamDef[] = [
  { key: 'rows', label: '一頁小節數（方形格）', min: 2, max: 8, default: 6 },
  { key: 'size', label: '墨點大小', min: 0.5, max: 2, default: 1 },
];

const STEPS = 16;
/** 格子在紙上的範圍（比例），照 Oto 量的。 */
const LEFT = 0.085;
const RIGHT = 0.915;
const TOP = 0.11;
const BOTTOM = 0.89;
/** Oto 的紙是 4:3 左右，那裡一頁 rows 列；更高的紙就多印幾列。 */
const REF_ASPECT = 0.79;
const SPREAD_SECONDS = 0.6;

/** hit 落在哪一小節、哪一個 16 分格。 */
function quantize(ctx: LookContext, time: number): { bar: number; step: number } | null {
  const { tempo } = ctx.readings;
  let bar = positionAt(tempo, time).bar;
  const start = timeOfBar(tempo, bar);
  const barSec = timeOfBar(tempo, bar + 1) - start;
  if (!(barSec > 0)) return null;
  let step = Math.round(((time - start) / barSec) * STEPS);
  if (step >= STEPS) {
    step = 0;
    bar += 1;
  }
  return step < 0 ? null : { bar, step };
}

/** 一頁幾列：參數是方形格的列數，依紙的長寬比換算。 */
export function rowsFor(ctx: LookContext): number {
  const base = Math.max(1, Math.round(paramNum(ctx, params, 'rows')));
  const aspect = Math.min(3, Math.max(0.4, ctx.h / Math.max(1, ctx.w) / REF_ASPECT));
  return Math.max(2, Math.round(base * aspect));
}

interface Page {
  rows: number;
  firstBar: number;
  lastBar: number;
  bar: number;
  step: number;
}

function pageAt(ctx: LookContext): Page {
  const rows = rowsFor(ctx);
  const pos = positionAt(ctx.readings.tempo, ctx.t);
  const page = Math.floor((pos.bar - 1) / rows);
  const firstBar = page * rows + 1;
  const step = Math.min(STEPS - 1, Math.floor(pos.barPhase * STEPS));
  return { rows, firstBar, lastBar: firstBar + rows - 1, bar: pos.bar, step };
}

interface Blot {
  hit: DrumHit;
  row: number;
  step: number;
}

/** 這一頁已經印上去的 hit（t 之後的不算）。 */
function printed(ctx: LookContext, page: Page): Blot[] {
  const out: Blot[] = [];
  for (const hit of ctx.readings.drums) {
    if (hit.time > ctx.t) break;
    const q = quantize(ctx, hit.time);
    if (!q || q.bar < page.firstBar || q.bar > page.lastBar) continue;
    out.push({ hit, row: q.bar - page.firstBar, step: q.step });
  }
  return out;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const page = pageAt(ctx);
  const { rows } = page;
  const size = paramNum(ctx, params, 'size');
  const unit = Math.min(w, h);
  const cw = (w * (RIGHT - LEFT)) / (STEPS - 1);
  const rh = rows > 1 ? (h * (BOTTOM - TOP)) / (rows - 1) : 0;
  const colX = (s: number) => w * LEFT + s * cw;
  const rowY = (r: number) => h * TOP + r * rh;
  // 墨點大小跟格距走，小格子裡也不會糊成一片
  const cell = Math.min(cw, rh || cw);

  // 紙：兩個主題都是淡色的紙（黑底主題用 ink 當紙色），整張先染一層淡淡的粉
  const sheet = theme.glow ? theme.ink : theme.paper;
  const dark = theme.glow ? theme.paper : theme.ink;
  const pink = theme.noteColors[11] ?? theme.accent;
  p.background(sheet);
  p.haze(w * 0.5, h * 0.5, Math.hypot(w, h) * 0.6, theme.accent, 0.07);

  const blots = printed(ctx, page);

  // 粉霧：hit 聚在哪裡就在哪裡暈開，越多越濃
  if (blots.length) {
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (const b of blots) {
      const k = b.hit.kind === 'kick' ? 1.6 : b.hit.kind === 'snare' ? 1 : 0.4;
      sx += colX(b.step) * k;
      sy += rowY(b.row) * k;
      sw += k;
    }
    const cx = sx / sw;
    const cy = sy / sw;
    let vx = 0;
    let vy = 0;
    for (const b of blots) {
      vx += (colX(b.step) - cx) ** 2;
      vy += (rowY(b.row) - cy) ** 2;
    }
    const spreadX = Math.sqrt(vx / blots.length);
    const spreadY = Math.sqrt(vy / blots.length);
    const fill = Math.min(1, blots.length / (rows * 5));
    const r = unit * (0.22 + 0.2 * fill) + Math.min(spreadX, spreadY) * 0.6;
    const a = 0.16 + 0.22 * fill;
    // 三團橫向（或直向）排開的霧拼成一朵橢圓的雲
    const horizontal = spreadX >= spreadY;
    const off = (horizontal ? spreadX : spreadY) * 0.7;
    for (const k of [-1, 0, 1]) {
      const x = cx + (horizontal ? k * off : 0);
      const y = cy + (horizontal ? 0 : k * off);
      p.haze(x, y, r * (k === 0 ? 1.15 : 0.85), theme.accent, a * (k === 0 ? 1 : 0.7));
      p.haze(x, y, r * 0.6, pink, a * 0.35);
    }
  }

  // 每格一個小點
  p.noStroke();
  p.fill(theme.accent, 0.55);
  const dotD = Math.max(1.5, cell * 0.075);
  for (let r = 0; r < rows; r++) {
    for (let s = 0; s < STEPS; s++) p.circle(colX(s), rowY(r), dotD);
  }

  // 墨點：落下後慢慢暈開；外圈是軟的色暈、中間一顆深一點的核
  for (const { hit, row, step } of blots) {
    const x = colX(step);
    const y = rowY(row);
    const age = t - hit.time;
    const spread = 1 + 0.35 * (1 - Math.exp(-age / SPREAD_SECONDS));
    const v = 0.55 + 0.45 * hit.velocity;
    if (hit.kind === 'hat') {
      p.haze(x, y, cell * 0.16 * size * spread, theme.accent, 0.55 * v);
      p.fill(theme.accent, 0.8);
      p.circle(x, y, dotD * 1.6);
      continue;
    }
    const kick = hit.kind === 'kick';
    const d = cell * (kick ? 0.62 : 0.46) * v * size * spread;
    const ink = kick ? pink : theme.accent;
    p.haze(x, y, d * 0.95, ink, 0.55);
    p.haze(x, y, d * 0.7, kick ? theme.accent : ink, 0.5);
    p.fill(ink, 0.75);
    p.circle(x, y, d * 0.5);
    p.fill(dark, kick ? 0.55 : 0.3);
    p.circle(x, y, d * 0.16);
    // 剛落下的墨：一圈很淡的漣漪
    if (age < 0.4) {
      p.noFill();
      p.stroke(ink, Math.max(1, unit * 0.0015), 1 - age / 0.4);
      p.circle(x, y, d * (1 + age * 2.5));
      p.noStroke();
    }
  }

  // 播放位置：空心圈
  const row = page.bar - page.firstBar;
  if (row >= 0 && row < rows) {
    p.noFill();
    p.stroke(pink, Math.max(1, unit * 0.0018));
    p.circle(colX(page.step), rowY(row), cell * 0.36);
    p.noStroke();
  }

  // 列首小節號
  p.fill(dark, 0.35);
  const fs = Math.max(8, Math.min(cell * 0.22, unit * 0.018));
  for (let r = 0; r < rows; r++) {
    p.text(String(page.firstBar + r), w * LEFT * 0.42, rowY(r) - fs * 0.55, {
      size: fs,
      font: 'mono',
      align: 'center',
    });
  }
}

function readouts(ctx: LookContext): Readout[] {
  const page = pageAt(ctx);
  return [
    { label: 'SHEET', value: `bars ${page.firstBar}–${page.lastBar}` },
    { label: 'STEP', value: `${page.step + 1} / ${STEPS}` },
    { label: 'BLOTS', value: String(printed(ctx, page).length) },
  ];
}

/** 墨點格：一張淡粉的紙，16 步一小節一列，每個 hit 落下一滴暈開的墨；hit 聚在哪裡粉霧就在哪裡。 */
export const blotLook: Look = {
  id: 'blot',
  number: 13,
  name: '墨點格',
  listens: ['drums', 'tempo'],
  params,
  draw,
  readouts,
};

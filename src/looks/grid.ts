import { positionAt, timeOfBar } from '../analysis/tempo';
import type { DrumHit, DrumKind } from '../analysis/types';
import type { Painter } from './painter/painter';
import { softDot } from './sheet';
import type { Look, LookContext, ParamDef, Readout } from './types';

const params: ParamDef[] = [{ key: 'rows', label: '一頁小節數', min: 1, max: 8, default: 8 }];

const STEPS = 16;
const ACTIVE_SECONDS = 0.15;
/** 每小節由上到下三條軌 */
export const LANES: DrumKind[] = ['hat', 'snare', 'kick'];

function rowsParam(ctx: LookContext): number {
  const v = ctx.params.rows;
  return typeof v === 'number' ? Math.max(1, Math.round(v)) : 8;
}

/** hit 落在哪一小節、哪一個 16 分格。step 16 進位到下一小節 step 0。 */
export function quantize(ctx: LookContext, time: number): { bar: number; step: number } | null {
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
  if (step < 0) return null;
  return { bar, step };
}

/** 目前這一頁的第一、最後一小節。 */
export function pageOf(ctx: LookContext): { first: number; last: number } {
  const rows = rowsParam(ctx);
  const bar = positionAt(ctx.readings.tempo, ctx.t).bar;
  const first = Math.floor((bar - 1) / rows) * rows + 1;
  return { first, last: first + rows - 1 };
}

/** 版面：左邊軌名欄、上面步數列，其餘平分給每小節一塊。 */
export function gridLayout(w: number, h: number, rows: number) {
  const u = Math.min(w, h) / 1000;
  const small = Math.max(18 * u, 14);
  const x0 = small * 5.2;
  const x1 = w - 1;
  const y0 = small * 2.2;
  const y1 = h - 1;
  const blockH = (y1 - y0) / rows;
  const cw = (x1 - x0) / STEPS;
  return {
    u,
    small,
    x0,
    x1,
    y0,
    y1,
    blockH,
    cw,
    colX: (s: number) => x0 + (s + 0.5) * cw,
    laneY: (row: number, lane: number) => y0 + row * blockH + blockH * (0.3 + lane * 0.27),
  };
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const rows = rowsParam(ctx);
  const G = gridLayout(w, h, rows);
  const { u, small } = G;
  const hair = Math.max(1, 1.2 * u);
  const pos = positionAt(ctx.readings.tempo, t);
  const { first, last } = pageOf(ctx);
  const curRow = pos.bar - first;
  const showLanes = G.blockH > small * 3.6;

  p.background(theme.paper);

  // 目前小節的播放欄：一條淡色直帶
  if (curRow >= 0 && curRow < rows) {
    const step = Math.min(STEPS - 1, Math.floor(pos.barPhase * STEPS));
    const bx = G.x0 + step * G.cw;
    const by = G.y0 + curRow * G.blockH;
    p.noStroke();
    p.fill(theme.accent, theme.glow ? 0.12 : 0.1);
    p.rect(bx, by, G.cw, G.blockH);
  }

  // 拍線（每 4 格粗一點）與小節分隔
  p.noFill();
  for (let s = 0; s <= STEPS; s++) {
    const x = G.x0 + s * G.cw;
    const beat = s % 4 === 0;
    p.stroke(theme.line, beat ? hair * 1.3 : hair, beat ? 0.95 : 0.4);
    p.line(x, G.y0, x, G.y1);
  }
  for (let r = 0; r <= rows; r++) {
    p.stroke(
      r === 0 || r === rows ? theme.mute : theme.line,
      hair,
      r === 0 || r === rows ? 0.7 : 1,
    );
    p.line(G.x0, G.y0 + r * G.blockH, G.x1, G.y0 + r * G.blockH);
  }
  // 軌線
  if (showLanes) {
    for (let r = 0; r < rows; r++) {
      for (let lane = 0; lane < LANES.length; lane++) {
        p.stroke(theme.line, hair, 0.55);
        p.line(G.x0, G.laneY(r, lane), G.x1, G.laneY(r, lane));
      }
    }
  }

  // 步數列與小節號、軌名
  p.noStroke();
  // 格子太窄就只標每拍的第一格（1、5、9、13）
  const everyStep = G.cw > small * 1.5;
  for (let s = 0; s < STEPS; s++) {
    if (!everyStep && s % 4 !== 0) continue;
    p.fill(s % 4 === 0 ? theme.ink : theme.mute, s % 4 === 0 ? 0.85 : 1);
    p.text(String(s + 1), G.colX(s), 0, {
      size: small,
      font: 'mono',
      align: 'center',
      weight: s % 4 === 0 ? 700 : 400,
    });
  }
  for (let r = 0; r < rows; r++) {
    const by = G.y0 + r * G.blockH;
    const isCur = r === curRow;
    p.fill(isCur ? theme.accent : theme.ink, isCur ? 1 : 0.85);
    p.text(String(first + r), 0, by + small * 0.35, {
      size: small * 1.15,
      font: 'mono',
      weight: 700,
    });
    if (showLanes) {
      p.fill(theme.mute);
      for (let lane = 0; lane < LANES.length; lane++) {
        p.text(LANES[lane].toUpperCase(), G.x0 - small * 0.5, G.laneY(r, lane) - small * 0.42, {
          size: small * 0.85,
          font: 'mono',
          align: 'right',
          tracking: 0.08,
        });
      }
    }
  }

  // hits：已打的墨色、還沒打的淡、剛打的強調色發光
  const kickD = Math.min(G.cw * 0.5, G.blockH * 0.2);
  const laneOf = (kind: DrumKind) => LANES.indexOf(kind);
  const lo = timeOfBar(ctx.readings.tempo, first) - 1;
  const hi = timeOfBar(ctx.readings.tempo, last + 1) + 1;
  for (const hit of ctx.readings.drums) {
    if (hit.time < lo || hit.time > hi) continue;
    const q = quantize(ctx, hit.time);
    if (!q || q.bar < first || q.bar > last) continue;
    const row = q.bar - first;
    const x = G.colX(q.step);
    const y = showLanes ? G.laneY(row, laneOf(hit.kind)) : G.y0 + (row + 0.5) * G.blockH;
    const age = t - hit.time;
    const played = age >= 0;
    const active = played && age < ACTIVE_SECONDS;
    drawHit(p, ctx, hit, x, y, kickD, played, active, hair);
  }

  // 播放線
  if (curRow >= 0 && curRow < rows) {
    const x = G.x0 + pos.barPhase * (G.x1 - G.x0);
    const by = G.y0 + curRow * G.blockH;
    p.noFill();
    p.stroke(theme.accent, Math.max(1.5, 2.4 * u));
    p.line(x, by, x, by + G.blockH);
  }
}

function drawHit(
  p: Painter,
  ctx: LookContext,
  hit: DrumHit,
  x: number,
  y: number,
  kickD: number,
  played: boolean,
  active: boolean,
  hair: number,
): void {
  const { theme } = ctx;
  const alpha = played ? 1 : 0.22;
  const color = active ? theme.accent : theme.ink;
  const pop = active ? 1.35 : 1;
  if (hit.kind === 'kick') {
    p.noStroke();
    const d = kickD * (0.55 + 0.45 * hit.velocity) * pop;
    if (active) softDot(p, theme, x, y, d, theme.accent);
    else {
      p.fill(theme.ink, played ? 0.9 : alpha);
      p.circle(x, y, d);
    }
  } else if (hit.kind === 'snare') {
    const r = kickD * 0.36 * (0.6 + 0.4 * hit.velocity) * pop;
    p.noFill();
    p.stroke(color, Math.max(1.5, hair * 2), alpha);
    p.line(x - r, y - r, x + r, y + r);
    p.line(x - r, y + r, x + r, y - r);
  } else {
    const len = kickD * 0.7 * (0.6 + 0.4 * hit.velocity) * pop;
    p.noFill();
    p.stroke(color, Math.max(1.5, hair * 1.8), alpha * 0.9);
    p.line(x, y - len / 2, x, y + len / 2);
  }
}

function readouts(ctx: LookContext): Readout[] {
  const { t, readings } = ctx;
  const pos = positionAt(readings.tempo, t);
  const { first, last } = pageOf(ctx);
  const barStart = timeOfBar(readings.tempo, pos.bar);
  let kicks = 0;
  let hits = 0;
  for (const d of readings.drums) {
    if (d.time > t) continue;
    hits++;
    if (d.kind === 'kick' && d.time >= barStart) kicks++;
  }
  return [
    { label: 'PAGE', value: `bars ${first}–${last}` },
    { label: 'BAR', value: `${pos.bar}.${pos.beat}` },
    { label: 'KICKS', value: String(kicks) },
    { label: 'HITS', value: String(hits) },
  ];
}

/** 鼓格：16 步一小節一塊，hat / snare / kick 三軌，像 Oto 的 Score。 */
export const gridLook: Look = {
  id: 'grid',
  number: 2,
  name: '鼓格',
  listens: ['drums', 'tempo'],
  params,
  draw,
  readouts,
};

import { bpmAt, positionAt, timeOfBar } from '../analysis/tempo';
import type { NoteEvent, TempoMap } from '../analysis/types';
import { midiName } from './glide';
import { noteColor } from './music';
import type { Painter, Point } from './painter/painter';
import { paramNum } from './sheet';
import type { Look, LookContext, ParamDef, Readout } from './types';

/**
 * 26 Arcade：上半是透視賽道（一個音高一條 lane，音符從遠處往判定線落下），
 * 下半是兩排按鍵。計分全部由 t 之前的音決定，同輸入同結果。
 */

const params: ParamDef[] = [{ key: 'lookahead', label: '前瞻秒數', min: 1, max: 4, default: 2 }];

export const MAX_LANES = 12;
/** 判定圓閃一下的長度（秒） */
export const FLASH = 0.15;
/** COMBO 條滿格的 combo 數 */
const COMBO_FULL = 20;
/** 透視深度：最遠處縮成 1 / (1 + DEPTH) */
const DEPTH = 5;
/** 音符過了判定線還可以再往下走多少（以前瞻比例計） */
const PAST = 0.015;

interface Chart {
  /** lane 的 midi，由低到高 */
  lanes: number[];
  /** 落在 lane 上的音（依 time 排序） */
  notes: NoteEvent[];
  /** 每顆音結算時的 combo 與累計分數 */
  combo: number[];
  score: number[];
}

const chartCache = new WeakMap<readonly NoteEvent[], WeakMap<TempoMap, Chart>>();

/**
 * 整首的譜面：lane = 出現過的音高（最多 12 條，太多就取出現次數最多的 12 個，同數取低音）；
 * combo = 連續沒有空超過 1 拍的音符數；每顆音得 100 + 10·combo。
 */
export function chartOf(notes: readonly NoteEvent[], tempo: TempoMap): Chart {
  let byTempo = chartCache.get(notes);
  if (!byTempo) {
    byTempo = new WeakMap();
    chartCache.set(notes, byTempo);
  }
  const hit = byTempo.get(tempo);
  if (hit) return hit;
  const count = new Map<number, number>();
  for (const n of notes) count.set(n.midi, (count.get(n.midi) ?? 0) + 1);
  const lanes = [...count.keys()]
    .sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0) || a - b)
    .slice(0, MAX_LANES)
    .sort((a, b) => a - b);
  const laneSet = new Set(lanes);
  const onLanes = notes.filter((n) => laneSet.has(n.midi));
  const combo: number[] = [];
  const score: number[] = [];
  let run = 0;
  let total = 0;
  let lastEnd = Number.NEGATIVE_INFINITY;
  for (const n of onLanes) {
    const beat = 60 / (bpmAt(tempo, n.time) || 120);
    run = n.time - lastEnd > beat ? 1 : run + 1;
    total += 100 + 10 * run;
    combo.push(run);
    score.push(total);
    lastEnd = Math.max(lastEnd, n.time + n.duration);
  }
  const chart = { lanes, notes: onLanes, combo, score };
  byTempo.set(tempo, chart);
  return chart;
}

/** t 這一刻的分數與 combo（現在離上一顆音的尾巴超過 1 拍，combo 就歸零） */
export function scoreAt(
  chart: Chart,
  tempo: TempoMap,
  t: number,
): { score: number; combo: number } {
  // 最後一顆 time ≤ t 的音（二分搜尋）
  let a = 0;
  let b = chart.notes.length;
  while (a < b) {
    const mid = (a + b) >> 1;
    if (chart.notes[mid].time <= t) a = mid + 1;
    else b = mid;
  }
  const i = a - 1;
  if (i < 0) return { score: 0, combo: 0 };
  let lastEnd = Number.NEGATIVE_INFINITY;
  for (let k = i; k >= 0 && k >= i - 64; k--)
    lastEnd = Math.max(lastEnd, chart.notes[k].time + chart.notes[k].duration);
  const beat = 60 / (bpmAt(tempo, t) || 120);
  return { score: chart.score[i], combo: t - lastEnd > beat ? 0 : chart.combo[i] };
}

function lookahead(ctx: LookContext): number {
  return Math.max(1, Math.min(4, paramNum(ctx, params, 'lookahead')));
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme, readings } = ctx;
  const tempo = readings.tempo;
  const chart = chartOf(readings.notes ?? [], tempo);
  const ahead = lookahead(ctx);
  const n = Math.max(1, chart.lanes.length);
  const u = Math.min(w, h);
  const hair = Math.max(1, u * 0.0012);

  // 版面：右邊一條 COMBO 條；上 60% 賽道、下面按鍵
  const barW = Math.max(u * 0.022, 6);
  const gap = u * 0.03;
  const fieldW = w - barW - gap;
  const cx = fieldW / 2;
  const trackTop = h * 0.07;
  const judgeY = h * 0.58;
  const keysTop = h * 0.67;
  const halfW = fieldW * 0.47;
  const horizonY = trackTop;
  // 深度 d：0 = 判定線，1 = ahead 秒之後；z = 1 + d·DEPTH，螢幕座標往消失點縮
  const zOf = (d: number) => 1 + d * DEPTH;
  const far = 1 / zOf(1);
  const yOf = (d: number) => horizonY + (judgeY - horizonY) * ((1 / zOf(d) - far) / (1 - far));
  const xOf = (lanePos: number, d: number) => cx + (lanePos * halfW) / zOf(d);
  // lanePos：-1..1，第 i 條 lane 的左右邊
  const edge = (i: number) => -1 + (2 * i) / n;
  const centre = (i: number) => -1 + (2 * i + 1) / n;
  const laneOf = new Map(chart.lanes.map((m, i) => [m, i]));
  const colour = (i: number) => noteColor(theme, chart.lanes[i] % 12);

  p.background(theme.paper);

  // 遠方的光：消失點一團淡淡的 accent，近處每條 lane 一點自己的顏色
  if (theme.glow) p.blend('add');
  p.haze(cx, horizonY + h * 0.02, u * 0.5, theme.accent, theme.glow ? 0.22 : 0.08);
  p.blend('normal');

  // lane 地板
  p.noStroke();
  for (let i = 0; i < n; i++) {
    const quad: Point[] = [
      { x: xOf(edge(i), 1), y: yOf(1) },
      { x: xOf(edge(i + 1), 1), y: yOf(1) },
      { x: xOf(edge(i + 1), -PAST), y: yOf(-PAST) },
      { x: xOf(edge(i), -PAST), y: yOf(-PAST) },
    ];
    p.fill(colour(i), theme.glow ? 0.07 : 0.08);
    p.shape(quad);
  }

  // 拍線：一拍一條橫線往判定線靠近，小節線粗一點，越遠越淡
  const pos = positionAt(tempo, t);
  const beatsPerBar = Math.max(1, tempo.timeSignatures[0]?.numerator ?? 4);
  const barStart = timeOfBar(tempo, pos.bar);
  const barLen = timeOfBar(tempo, pos.bar + 1) - barStart;
  if (barLen > 0) {
    const beatLen = barLen / beatsPerBar;
    const first = Math.ceil((t - barStart) / beatLen);
    for (let k = first; barStart + k * beatLen <= t + ahead; k++) {
      const d = (barStart + k * beatLen - t) / ahead;
      const downbeat = ((k % beatsPerBar) + beatsPerBar) % beatsPerBar === 0;
      p.stroke(theme.ink, hair * (downbeat ? 2 : 1), (1 - d) * (downbeat ? 0.4 : 0.18));
      p.line(xOf(-1, d), yOf(d), xOf(1, d), yOf(d));
    }
  }

  // lane 邊線
  for (let i = 0; i <= n; i++) {
    p.stroke(theme.line, hair * (i === 0 || i === n ? 2 : 1));
    p.line(xOf(edge(i), 1), yOf(1), xOf(edge(i), -PAST), yOf(-PAST));
  }

  // 音符：頭是一條橫條，長音拖一條同色的尾巴
  const lo = t - ahead * PAST;
  const hi = t + ahead;
  const flashing: number[] = [];
  const sounding = new Set<number>();
  p.noStroke();
  for (const note of chart.notes) {
    if (note.time > hi) break;
    const end = note.time + note.duration;
    const lane = laneOf.get(note.midi);
    if (lane === undefined || end < lo) continue;
    if (note.time <= t && t < end) sounding.add(lane);
    if (t - note.time >= 0 && t - note.time < FLASH) flashing.push(lane);
    const d0 = Math.max(-PAST, (note.time - t) / ahead);
    const d1 = Math.min(1, (end - t) / ahead);
    const inset = 0.16 / n;
    const l = edge(lane) + inset;
    const r = edge(lane + 1) - inset;
    const col = colour(lane);
    if (d1 > d0) {
      const tail: Point[] = [
        { x: xOf(l + inset * 2, d1), y: yOf(d1) },
        { x: xOf(r - inset * 2, d1), y: yOf(d1) },
        { x: xOf(r - inset * 2, d0), y: yOf(d0) },
        { x: xOf(l + inset * 2, d0), y: yOf(d0) },
      ];
      p.fill(col, 0.35);
      p.shape(tail);
    }
    if (note.time >= lo) {
      const head = Math.min(1, d0 + 0.035);
      const alpha = note.time < t ? 0.35 : 1;
      const bar: Point[] = [
        { x: xOf(l, head), y: yOf(head) },
        { x: xOf(r, head), y: yOf(head) },
        { x: xOf(r, d0), y: yOf(d0) },
        { x: xOf(l, d0), y: yOf(d0) },
      ];
      p.fill(col, alpha);
      p.shape(bar);
    }
  }

  // 判定線與判定圓
  p.stroke(theme.ink, hair * 1.5, 0.7);
  p.line(xOf(-1, 0), judgeY, xOf(1, 0), judgeY);
  const ringD = Math.min(((2 * halfW) / n) * 0.62, u * 0.09);
  for (let i = 0; i < n; i++) {
    const x = xOf(centre(i), 0);
    const col = colour(i);
    const lit = flashing.includes(i);
    if (lit) {
      if (theme.glow) p.blend('add');
      p.haze(x, judgeY, ringD * 1.6, col, theme.glow ? 0.6 : 0.3);
      p.blend('normal');
    }
    p.noStroke();
    if (lit || sounding.has(i)) {
      if (lit && theme.glow) p.glow(col, ringD * 0.5);
      p.fill(col, lit ? 1 : 0.45);
      p.circle(x, judgeY, ringD * (lit ? 1.08 : 1));
      if (lit && theme.glow) p.noGlow();
    } else {
      p.fill(theme.paper);
      p.circle(x, judgeY, ringD);
    }
    p.noFill();
    p.stroke(col, Math.max(1.5, ringD * 0.07));
    p.circle(x, judgeY, ringD);
    p.stroke(col, hair, 0.5);
    p.circle(x, judgeY, ringD * 0.55);
  }

  // 下半：兩排按鍵，標音名；正在響的填 lane 色
  const perRow = Math.ceil(n / 2);
  const keyGap = u * 0.014;
  const keyW = (fieldW - keyGap * (perRow + 1)) / perRow;
  const keyH = Math.min((h - keysTop - keyGap) / 2, keyW * 1.9);
  // 按鍵區在剩下的高度裡置中（寬格子時鍵高被鍵寬限制住）
  const keysY = keysTop + (h - keysTop - (keyH * 2 + keyGap)) / 2;
  for (let i = 0; i < n; i++) {
    const row = i < perRow ? 1 : 0; // 低音在下排
    const col = i < perRow ? i : i - perRow;
    const x = keyGap + col * (keyW + keyGap);
    const y = keysY + row * (keyH + keyGap);
    const on = sounding.has(i);
    p.noStroke();
    p.fill(on ? colour(i) : theme.mute, on ? 1 : 0.2);
    p.rect(x, y, keyW, keyH);
    p.noFill();
    p.stroke(on ? colour(i) : theme.mute, hair, on ? 1 : 0.6);
    p.rect(x, y, keyW, keyH);
    // 鍵頂一條 lane 色，按鍵和賽道對得起來
    p.noStroke();
    p.fill(colour(i), on ? 1 : 0.8);
    p.rect(x, y, keyW, Math.max(2, keyH * 0.06));
    p.fill(on ? theme.paper : theme.ink, on ? 1 : 0.85);
    p.text(midiName(chart.lanes[i] ?? 60), x + keyW / 2, y + keyH * 0.62, {
      size: Math.min(keyW * 0.28, keyH * 0.3),
      font: 'mono',
      align: 'center',
      weight: 700,
    });
  }

  // 右邊直立的 COMBO 條
  const { score, combo } = scoreAt(chart, tempo, t);
  const barX = w - barW;
  const barTop = trackTop;
  const barH = judgeY - barTop;
  const fill = Math.min(1, combo / COMBO_FULL);
  p.noFill();
  p.stroke(theme.mute, hair, 0.7);
  p.rect(barX, barTop, barW, barH);
  p.noStroke();
  const segs = 20;
  const segH = barH / segs;
  for (let s = 0; s < segs; s++) {
    const on = s < Math.round(fill * segs);
    p.fill(on ? theme.accent : theme.mute, on ? 0.35 + (0.65 * s) / segs : 0.12);
    p.rect(
      barX + barW * 0.15,
      barTop + barH - (s + 1) * segH + segH * 0.15,
      barW * 0.7,
      segH * 0.7,
    );
  }
  p.fill(theme.mute);
  p.text('COMBO', barX + barW, barTop + barH + u * 0.03, {
    size: u * 0.016,
    font: 'mono',
    align: 'right',
  });

  // 左上 HUD：分數
  p.fill(theme.mute);
  p.text('SCORE', 0, trackTop * 0.42, { size: u * 0.016, font: 'mono', align: 'left' });
  p.fill(theme.ink);
  p.text(String(score).padStart(7, '0'), 0, trackTop * 0.42 + u * 0.045, {
    size: u * 0.04,
    font: 'mono',
    align: 'left',
    weight: 700,
  });
  if (combo > 1) {
    p.fill(theme.accent);
    p.text(`${combo} COMBO`, fieldW, trackTop * 0.42 + u * 0.045, {
      size: u * 0.03,
      font: 'mono',
      align: 'right',
      weight: 700,
    });
  }
}

function readouts(ctx: LookContext): Readout[] {
  const tempo = ctx.readings.tempo;
  const chart = chartOf(ctx.readings.notes ?? [], tempo);
  const { score, combo } = scoreAt(chart, tempo, ctx.t);
  return [
    { label: 'SCORE', value: score.toLocaleString('en-US') },
    { label: 'COMBO', value: String(combo) },
    { label: 'LANES', value: `Notes · ${chart.lanes.length}` },
    { label: 'PART', value: 'Track' },
  ];
}

/** 街機：音符沿透視賽道落向判定線，下面一排排按鍵跟著亮。 */
export const arcadeLook: Look = {
  id: 'arcade',
  number: 26,
  name: '街機',
  listens: ['notes', 'tempo'],
  params,
  draw,
  readouts,
};

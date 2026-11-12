import { positionAt, timeOfBar } from '../analysis/tempo';
import type { DrumKind } from '../analysis/types';
import type { Painter } from './painter/painter';
import { drawLabel, paramNum, rngFor } from './sheet';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [{ key: 'bars', label: '一片天空小節數', min: 4, max: 16, default: 8 }];

const LEFT = 0.08;
const RIGHT = 0.92;
const TOP = 0.16;
const BOTTOM = 0.84;
/** 每種鼓件住的高度帶（0 上 1 下） */
const BAND: Record<DrumKind, [number, number]> = {
  hat: [0, 0.4],
  snare: [0.3, 0.7],
  kick: [0.55, 1],
};
const FLASH = 0.35;

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const { tempo, drums } = ctx.readings;
  const bars = Math.max(1, Math.round(paramNum(ctx, params, 'bars')));
  const pos = positionAt(tempo, t);
  const firstBar = Math.floor((pos.bar - 1) / bars) * bars + 1;
  const start = timeOfBar(tempo, firstBar);
  const end = timeOfBar(tempo, firstBar + bars);
  const span = end > start ? end - start : 1;
  const xOf = (time: number) => w * LEFT + ((time - start) / span) * w * (RIGHT - LEFT);

  p.background(theme.paper);

  // 地平線：一道淡淡的弧
  p.noFill();
  p.stroke(theme.line, h * 0.0008);
  const arc: { x: number; y: number }[] = [];
  for (let i = 0; i <= 40; i++) {
    const u = i / 40;
    arc.push({
      x: w * LEFT + u * w * (RIGHT - LEFT),
      y: h * 0.58 - Math.sin(u * Math.PI) * h * 0.06,
    });
  }
  p.polyline(arc);

  // 星星：這片天空裡的每個 hit，位置固定；播到的才亮
  p.noStroke();
  for (let i = 0; i < drums.length; i++) {
    const hit = drums[i];
    if (hit.time < start) continue;
    if (hit.time >= end) break;
    const rng = rngFor(ctx.seed, i);
    const [a, b] = BAND[hit.kind];
    const y = h * TOP + (a + (b - a) * rng()) * h * (BOTTOM - TOP);
    const x = xOf(hit.time) + (rng() - 0.5) * w * 0.01;
    const lit = hit.time <= t;
    const size =
      h *
      (hit.kind === 'kick' ? 0.006 : hit.kind === 'snare' ? 0.0045 : 0.003) *
      (0.6 + 0.6 * hit.velocity);
    if (!lit) {
      p.fill(theme.mute, 0.35);
      p.circle(x, y, size * 0.6);
      continue;
    }
    const age = t - hit.time;
    const flash = age < FLASH ? 1 - age / FLASH : 0;
    const color = hit.kind === 'kick' ? theme.accent : theme.ink;
    p.fill(color, 0.5 + 0.5 * flash);
    p.circle(x, y, size * 2.4 * (0.5 + flash));
    p.fill(theme.ink);
    p.circle(x, y, size);
  }

  // 小節號
  p.fill(theme.mute);
  for (let b = 0; b < bars; b += 2) {
    p.text(String(firstBar + b), xOf(timeOfBar(tempo, firstBar + b)), h * 0.88, {
      size: h * 0.01,
      font: 'mono',
      align: 'center',
    });
  }
  drawLabel(p, ctx);
}

/** 星圖：一片天空 8 小節，每個 hit 是一顆星，播到哪點亮到哪；kick 低、snare 中、hat 高。 */
export const starsLook: Look = {
  id: 'stars',
  number: 23,
  name: '星圖',
  listens: ['drums', 'tempo'],
  params,
  draw,
};

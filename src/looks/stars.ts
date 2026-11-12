import { binHz, binValue, frameAt } from '../analysis/audio/spectrum';
import { positionAt, timeOfBar } from '../analysis/tempo';
import type { DrumHit, DrumKind, Readings } from '../analysis/types';
import { midiName } from './glide';
import type { Painter } from './painter/painter';
import { bassAt, drawLabel, paramNum, rngFor } from './sheet';
import type { Look, LookContext, ParamDef, Readout } from './types';

const params: ParamDef[] = [{ key: 'bars', label: '一片天空小節數', min: 4, max: 16, default: 8 }];

const LEFT = 0.02;
const RIGHT = 0.98;
const TOP = 0.02;
/** 星空的底；再往下是小節號 */
const BOTTOM = 0.93;
const AXIS = 0.965;
/** 每種鼓件住的高度帶（0 上 1 下） */
const BAND: Record<DrumKind, [number, number]> = {
  hat: [0, 0.45],
  snare: [0.25, 0.75],
  kick: [0.5, 1],
};
const FLASH = 0.35;
/** 背景的細塵：每片天空固定幾顆，不跟 hit 走 */
const DUST = 140;
/** 每種鼓件找音高的頻段（沒有 bass 讀數時用頻譜峰值） */
const PITCH_BAND: Record<DrumKind, [number, number]> = {
  kick: [30, 160],
  snare: [150, 1000],
  hat: [3000, 12000],
};

interface Sky {
  firstBar: number;
  bars: number;
  start: number;
  end: number;
}

function skyAt(ctx: LookContext): Sky {
  const { tempo } = ctx.readings;
  const bars = Math.max(1, Math.round(paramNum(ctx, params, 'bars')));
  const pos = positionAt(tempo, ctx.t);
  const firstBar = Math.floor((pos.bar - 1) / bars) * bars + 1;
  const start = timeOfBar(tempo, firstBar);
  const end = timeOfBar(tempo, firstBar + bars);
  return { firstBar, bars, start, end: end > start ? end : start + 1 };
}

/** 一個 hit 的音名：當下有 bass 就用 bass，沒有就用那一刻該鼓件頻段的頻譜峰值，再沒有就寫鼓件名。 */
export function noteOf(r: Readings, hit: DrumHit): string {
  const b = bassAt(r.bass ?? [], hit.time, true);
  if (b) return midiName(b.midi);
  const s = r.spectrum;
  if (s) {
    const [lo, hi] = PITCH_BAND[hit.kind];
    const f = frameAt(s, hit.time);
    let best = -1;
    let bestV = -1;
    for (let k = 0; k < s.bins; k++) {
      const hz = binHz(s, k);
      if (hz < lo || hz > hi) continue;
      const v = binValue(s, f, k);
      if (v > bestV) {
        bestV = v;
        best = k;
      }
    }
    if (best >= 0 && bestV > 0) return midiName(69 + 12 * Math.log2(binHz(s, best) / 440));
  }
  return hit.kind.toUpperCase();
}

/** 虛線：每 dash 畫一段、空 gap。 */
function dashed(
  p: Painter,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dash: number,
  gap: number,
) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len <= 0) return;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  for (let d = 0; d < len; d += dash + gap) {
    const e = Math.min(len, d + dash);
    p.line(x1 + ux * d, y1 + uy * d, x1 + ux * e, y1 + uy * e);
  }
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const { tempo, drums } = ctx.readings;
  const sky = skyAt(ctx);
  const span = sky.end - sky.start;
  const xOf = (time: number) => w * LEFT + ((time - sky.start) / span) * w * (RIGHT - LEFT);
  const unit = Math.min(w, h);
  const thin = Math.max(1, unit * 0.0012);

  p.background(theme.paper);

  // 細塵：這片天空固定的一把小點，讓天空不是空的
  p.noStroke();
  p.fill(theme.mute, 0.35);
  const dust = rngFor(ctx.seed ^ 0x1b873593, sky.firstBar);
  for (let i = 0; i < DUST; i++) {
    const d = unit * (0.0012 + 0.0018 * dust());
    p.circle(w * dust(), h * BOTTOM * dust(), d);
  }

  // 地平線：一道虛線弧，從左低到中間拱起再落下
  p.noFill();
  p.stroke(theme.mute, thin, 0.7);
  const arcY = (u: number) => h * 0.5 - Math.sin(u * Math.PI * 0.9 + 0.15) * h * 0.06;
  const segs = 90;
  for (let i = 0; i < segs; i += 2) {
    const u0 = i / segs;
    const u1 = (i + 1) / segs;
    p.line(u0 * w, arcY(u0), u1 * w, arcY(u1));
  }

  // 星星：這片天空的每個 hit，位置固定；還沒播到的是灰色，播到的點亮
  p.noStroke();
  let latest: { x: number; y: number; size: number; hit: DrumHit } | null = null;
  for (let i = 0; i < drums.length; i++) {
    const hit = drums[i];
    if (hit.time < sky.start) continue;
    if (hit.time >= sky.end) break;
    const rng = rngFor(ctx.seed, i);
    const [a, b] = BAND[hit.kind];
    const y = h * TOP + (a + (b - a) * rng()) * h * (BOTTOM - TOP);
    const x = xOf(hit.time) + (rng() - 0.5) * w * 0.012;
    const size =
      unit *
      (hit.kind === 'kick' ? 0.016 : hit.kind === 'snare' ? 0.012 : 0.008) *
      (0.6 + 0.5 * hit.velocity);
    if (hit.time > t) {
      p.fill(theme.mute, theme.glow ? 0.55 : 0.4);
      p.circle(x, y, size);
      continue;
    }
    const age = t - hit.time;
    const flash = age < FLASH ? 1 - age / FLASH : 0;
    // 剛亮的星短暫放大，之後就是一顆實心的亮點
    p.fill(theme.ink, 0.95);
    p.circle(x, y, size * (1.1 + 0.6 * flash));
    latest = { x, y, size, hit };
  }

  // 播放頭：一條虛線直劃整片天空
  const px = xOf(Math.min(sky.end, Math.max(sky.start, t)));
  p.stroke(theme.mute, thin, 0.9);
  dashed(p, px, 0, px, h * BOTTOM, unit * 0.006, unit * 0.006);

  // 最新點亮的那顆：細圈加音名
  if (latest) {
    p.noFill();
    p.stroke(theme.accent, thin, 0.55);
    p.circle(latest.x, latest.y, latest.size * 2 + unit * 0.05);
    p.noStroke();
    p.fill(theme.mute);
    p.text(noteOf(ctx.readings, latest.hit), latest.x + unit * 0.022, latest.y - unit * 0.009, {
      size: unit * 0.018,
      font: 'mono',
      align: 'left',
    });
  }

  // 小節號：每兩小節一個，含這片天空的終點
  p.noStroke();
  p.fill(theme.mute);
  for (let b = 0; b <= sky.bars; b += 2) {
    const x = xOf(timeOfBar(tempo, sky.firstBar + b));
    p.text(String(sky.firstBar + b), x, h * AXIS, {
      size: unit * 0.02,
      font: 'mono',
      align: b === 0 ? 'left' : b >= sky.bars ? 'right' : 'center',
    });
  }
  drawLabel(p, ctx);
}

function readouts(ctx: LookContext): Readout[] {
  const sky = skyAt(ctx);
  let lit = 0;
  for (const d of ctx.readings.drums) {
    if (d.time >= sky.end || d.time > ctx.t) break;
    if (d.time >= sky.start) lit++;
  }
  const pos = positionAt(ctx.readings.tempo, ctx.t);
  return [
    { label: 'STARS LIT', value: String(lit) },
    { label: 'SKY', value: `bars ${sky.firstBar}–${sky.firstBar + sky.bars - 1}` },
    { label: 'TEMPO', value: `${Math.round(pos.bpm)} BPM` },
  ];
}

/** 星圖：一片天空 8 小節，每個 hit 是一顆星，整片先以灰色排好，虛線播放頭走到哪點亮到哪；最新那顆圈起來標音名。 */
export const starsLook: Look = {
  id: 'stars',
  number: 23,
  name: '星圖',
  listens: ['drums', 'tempo'],
  params,
  draw,
  readouts,
};

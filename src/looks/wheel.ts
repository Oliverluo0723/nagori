import type { ChordEvent, KeyInfo } from '../analysis/types';
import { FIFTHS, fifthsIndex, pcName } from './music';
import type { Painter } from './painter/painter';
import { bassAt } from './sheet';
import type { Look, LookContext, Readout } from './types';

const SECTOR = Math.PI / 6;
const START = -Math.PI / 2 - SECTOR / 2; // C 的扇面中心在 12 點鐘
const GAP = 0.035; // 扇面之間的縫（弧度）
const FADE_IN = 0.25;
/** 剛過去的和弦還留著多少秒的餘音 */
const DECAY = 2.5;
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

export function sectorAngles(pc: number): [number, number] {
  const i = fifthsIndex(pc);
  return [START + i * SECTOR + GAP / 2, START + (i + 1) * SECTOR - GAP / 2];
}

export function currentChord(
  chords: ChordEvent[],
  t: number,
): { now?: ChordEvent; next?: ChordEvent } {
  let now: ChordEvent | undefined;
  let next: ChordEvent | undefined;
  for (const c of chords) {
    if (c.time <= t && t < c.time + c.duration) now = c;
    else if (c.time > t && (!next || c.time < next.time)) next = c;
  }
  return { now, next };
}

function scale(key: KeyInfo): Set<number> {
  const steps = key.mode === 'minor' ? MINOR_STEPS : MAJOR_STEPS;
  return new Set(steps.map((s) => (key.tonic + s) % 12));
}

/**
 * 每個 pitch class 現在響多少（0..1）：目前和弦的根音 0.82、其他和弦音 0.62，
 * 剛過去的和弦依時間淡掉，正在響的 bass 音加一點，調內音有一層底。
 */
export function pitchWeights(ctx: LookContext): number[] {
  const { t } = ctx;
  const out = new Array(12).fill(0);
  const key = ctx.readings.key;
  if (key) for (const pc of scale(key)) out[pc] = 0.14;
  for (const c of ctx.readings.chords ?? []) {
    if (c.time > t) break;
    const end = c.time + c.duration;
    if (t < end) {
      const fade = Math.min(1, (t - c.time) / FADE_IN);
      for (const pc of c.notes) {
        const v = (pc === c.root ? 0.82 : 0.62) * fade;
        out[pc] = Math.max(out[pc], v);
      }
    } else if (t - end < DECAY) {
      const k = 1 - (t - end) / DECAY;
      for (const pc of c.notes) out[pc] = Math.max(out[pc], 0.5 * k * k);
    }
  }
  const b = bassAt(ctx.readings.bass ?? [], t);
  if (b) {
    const pc = ((Math.round(b.midi) % 12) + 12) % 12;
    out[pc] = Math.min(1, out[pc] + 0.18);
  }
  return out;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const u = Math.min(w, h) / 1000;
  const small = Math.max(19 * u, 15);
  const chords = ctx.readings.chords ?? [];
  const { now } = currentChord(chords, t);
  const key = ctx.readings.key;
  const inKey = key ? scale(key) : new Set<number>();
  const weights = pitchWeights(ctx);

  // 輪子盡量大：寬度吃滿；格子夠高時下面接一條和弦捲軸，不然置中
  const R0 = Math.min(w / 2 - small * 2.4, h / 2 - small * 2.6);
  const withRoll = h - 2 * (R0 + small * 2.6) > h * 0.22;
  const R = withRoll ? Math.min(R0, h * 0.3) : R0;
  const cx = w / 2;
  const cy = withRoll ? R + small * 2.6 : h / 2;
  const rIn = R * 0.34;
  const hair = Math.max(1, 1.3 * u);

  p.background(theme.paper);

  // 底：12 個扇面輪廓
  p.noFill();
  p.stroke(theme.line, hair);
  for (const pc of FIFTHS) {
    const [a, b] = sectorAngles(pc);
    p.wedge(cx, cy, rIn, R, a, b);
  }

  // 扇面半徑 = 這個音現在響多少；灰階深淺也跟著
  p.noStroke();
  for (const pc of FIFTHS) {
    if (now && pc === now.root) continue;
    const v = weights[pc];
    if (v <= 0) continue;
    const [a, b] = sectorAngles(pc);
    p.fill(theme.ink, 0.12 + 0.7 * v);
    p.wedge(cx, cy, rIn, rIn + (R - rIn) * v, a, b);
  }

  // 目前和弦的根音：強調色扇面加滿格外框
  if (now) {
    const [a, b] = sectorAngles(now.root);
    const v = weights[now.root];
    const mid = (a + b) / 2;
    const rr = rIn + (R - rIn) * v;
    if (theme.glow) {
      p.haze(
        cx + Math.cos(mid) * rr * 0.8,
        cy + Math.sin(mid) * rr * 0.8,
        R * 0.6,
        theme.accent,
        0.2,
      );
    }
    p.fill(theme.accent, 0.92);
    p.wedge(cx, cy, rIn, rr, a, b);
    p.noFill();
    p.stroke(theme.accent, Math.max(1.5, 2.2 * u));
    p.wedge(cx, cy, rIn, R, a, b);
  }

  // 中心圓
  p.noStroke();
  p.fill(theme.paper);
  p.circle(cx, cy, rIn * 1.9);

  // 中心：調性
  const big = rIn * 0.95;
  p.fill(theme.ink);
  p.text(key ? pcName(key.tonic) : '–', cx, cy - big * 0.62, {
    size: big,
    font: 'sans',
    align: 'center',
    weight: 700,
  });
  if (key) {
    p.fill(theme.mute);
    p.text(key.mode.toUpperCase(), cx, cy + big * 0.5, {
      size: small,
      font: 'mono',
      align: 'center',
      tracking: 0.12,
    });
  }

  // 扇面外側音名：目前根音強調色、調內墨色粗體、調外灰
  for (const pc of FIFTHS) {
    const [a, b] = sectorAngles(pc);
    const mid = (a + b) / 2;
    const r = R + small * 1.5;
    const isRoot = now?.root === pc;
    p.fill(isRoot ? theme.accent : inKey.has(pc) ? theme.ink : theme.mute);
    p.text(pcName(pc), cx + Math.cos(mid) * r, cy + Math.sin(mid) * r - small * 0.6, {
      size: small,
      font: 'mono',
      align: 'center',
      weight: isRoot || inKey.has(pc) ? 700 : 400,
    });
  }

  if (withRoll) drawRoll(p, ctx, cy + R + small * 4, small, inKey);
}

/** 和弦捲軸的時間窗（秒）：播放線在中間，左邊響過、右邊預告 */
const ROLL_SECONDS = 16;

/** 輪子下方的和弦捲軸：12 列照五度圈排，每個和弦的組成音畫成一段橫條。 */
function drawRoll(p: Painter, ctx: LookContext, top: number, small: number, inKey: Set<number>) {
  const { w, h, t, theme } = ctx;
  const chords = ctx.readings.chords ?? [];
  const u = Math.min(w, h) / 1000;
  const hair = Math.max(1, 1.2 * u);
  const x0 = small * 3;
  const x1 = w - 1;
  const y0 = top + small * 2;
  const y1 = h - 1;
  const rowH = (y1 - y0) / 12;
  const nowX = (x0 + x1) / 2;
  const pxPerSec = (x1 - x0) / ROLL_SECONDS;
  const xOf = (time: number) => nowX + (time - t) * pxPerSec;
  const rowY = (pc: number) => y0 + fifthsIndex(pc) * rowH;

  // 列線與音名
  p.noFill();
  for (let i = 0; i <= 12; i++) {
    p.stroke(theme.line, hair, i === 0 || i === 12 ? 0.9 : 0.5);
    p.line(x0, y0 + i * rowH, x1, y0 + i * rowH);
  }
  p.noStroke();
  for (const pc of FIFTHS) {
    p.fill(inKey.has(pc) ? theme.ink : theme.mute, inKey.has(pc) ? 0.85 : 1);
    p.text(pcName(pc), 0, rowY(pc) + rowH / 2 - small * 0.55, { size: small, font: 'mono' });
  }

  // 和弦塊
  const lo = t - ROLL_SECONDS / 2;
  const hi = t + ROLL_SECONDS / 2;
  let nameEnd = Number.NEGATIVE_INFINITY;
  for (const c of chords) {
    const end = c.time + c.duration;
    if (end < lo) continue;
    if (c.time > hi) break;
    const a = Math.max(x0, xOf(c.time));
    const b = Math.min(x1, xOf(end));
    if (b - a < 1) continue;
    const isNow = c.time <= t && t < end;
    const past = end <= t;
    const pad = Math.max(1, 2 * u);
    for (const pc of c.notes) {
      const isRoot = pc === c.root;
      if (isNow && isRoot) p.fill(theme.accent);
      else p.fill(theme.ink, isNow ? 0.85 : past ? 0.45 : 0.18);
      p.rect(a + pad, rowY(pc) + rowH * 0.22, b - a - 2 * pad, rowH * 0.56);
    }
    // 和弦名：跟前一個名字擠在一起就略過（目前的和弦一定寫）
    if (xOf(c.time) >= x0 && (isNow || a >= nameEnd)) {
      nameEnd = a + pad + (c.name.length * 0.6 + 0.8) * small;
      p.fill(isNow ? theme.accent : theme.mute);
      p.text(c.name, a + pad, top, { size: small, font: 'mono', weight: isNow ? 700 : 400 });
    }
  }

  // 播放線
  p.noFill();
  p.stroke(theme.accent, Math.max(1.5, 2 * u));
  p.line(nowX, y0 - small * 0.4, nowX, y1);
}

function readouts(ctx: LookContext): Readout[] {
  const { now, next } = currentChord(ctx.readings.chords ?? [], ctx.t);
  const key = ctx.readings.key;
  return [
    { label: 'KEY', value: key ? `≈ ${key.name}` : '—' },
    { label: 'CHORD NOW', value: now?.name ?? '—' },
    { label: 'NEXT', value: next?.name ?? '—' },
    { label: 'ORDER', value: 'circle of fifths' },
  ];
}

/** 調性輪：五度圈，扇面長短是每個音現在響多少，目前和弦根音亮起。 */
export const wheelLook: Look = {
  id: 'wheel',
  number: 1,
  name: '和弦輪',
  listens: ['chords', 'key'],
  params: [],
  draw,
  readouts,
};

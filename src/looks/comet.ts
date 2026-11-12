import type { ChordEvent } from '../analysis/types';
import { midiName } from './glide';
import { noteColor, pcName } from './music';
import type { Painter } from './painter/painter';
import {
  bandSeries,
  bassAt,
  formatTime,
  paramNum,
  pitchRange,
  rngFor,
  smoothAt,
  ticksAlive,
} from './sheet';
import type { Look, LookContext, ParamDef, Readout } from './types';

const params: ParamDef[] = [
  { key: 'tail', label: '尾巴秒數', min: 1, max: 10, default: 5 },
  { key: 'sparkle', label: '火花量', min: 0, max: 2, default: 1 },
];

/** 彗星頭在長邊上的位置（從頭那端算） */
const HEAD = 0.16;
/** 音高在短邊上用掉的範圍 */
const SIDE = 0.12;
/** 尾巴的取樣：每秒幾個點 */
const RATE = 24;
const STARS = 140;
const KICK_SPARKS = 9;
const SMOOTH_SECONDS = 0.25;
const SMOOTH_TAPS = 12;

/**
 * 版面：長格子裡彗星往上飛、尾巴拖到底；寬格子裡往右飛、尾巴拖到左邊。
 * along 0 = 頭、1 = 尾巴末端；u 0..1 是音高（低到高）。
 */
export function cometFrame(w: number, h: number) {
  const tall = h >= w;
  const long = tall ? h : w;
  const short = tall ? w : h;
  const at = (along: number, u: number) => {
    const a = long * (HEAD + (1 - HEAD) * along);
    const c = short * (SIDE + (1 - 2 * SIDE) * u);
    return tall ? { x: c, y: a } : { x: long - a, y: short - c };
  };
  return { tall, long, short, at };
}

function chordAt(chords: ChordEvent[], time: number): ChordEvent | null {
  for (const c of chords) {
    if (c.time > time) break;
    if (time < c.time + c.duration) return c;
  }
  return null;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const { bass, spectrum } = ctx.readings;
  const chords = ctx.readings.chords ?? [];
  const tail = paramNum(ctx, params, 'tail');
  const sparkle = paramNum(ctx, params, 'sparkle');
  const F = cometFrame(w, h);
  const unit = Math.min(w, h);
  const hair = Math.max(1, unit * 0.0012);
  const fs = Math.max(8, unit * 0.017);
  const notes = bass ?? [];
  const [lo, hi] = pitchRange(notes);
  const low = spectrum ? bandSeries(spectrum, 30, 150) : null;

  // 高度：有 bass 音就用音高，沒有就用低頻能量
  const rawAt = (time: number): number | null => {
    if (time < 0) return null;
    if (notes.length) {
      const n = bassAt(notes, time, true);
      return n ? (n.midi - lo) / (hi - lo) : null;
    }
    if (low && spectrum) return Math.min(1, smoothAt(low, spectrum.fps, time, 0.15) * 1.4);
    return null;
  };
  // 往回平滑 0.25 秒：音與音之間的跳躍變成一段彎，像彗星轉向
  const heightAt = (time: number): number | null => {
    let sum = 0;
    let n = 0;
    for (let k = 0; k < SMOOTH_TAPS; k++) {
      const u = rawAt(time - (k * SMOOTH_SECONDS) / (SMOOTH_TAPS - 1));
      if (u === null) continue;
      sum += u;
      n++;
    }
    return n ? sum / n : null;
  };
  // 顏色：那一刻的和弦根音，沒有和弦就用 bass 的音名
  const colorAt = (time: number): string => {
    const c = chordAt(chords, time);
    if (c) return noteColor(theme, c.root);
    const n = notes.length ? bassAt(notes, time, true) : null;
    return n ? noteColor(theme, Math.round(n.midi)) : theme.accent;
  };
  const along = (time: number) => (t - time) / tail;
  const color = colorAt(t);

  p.background(theme.paper);

  // 星空：固定種子的星點，順著尾巴方向慢慢往後流，遠近兩層
  p.noStroke();
  const sky = rngFor(ctx.seed, 9001);
  for (let i = 0; i < STARS; i++) {
    const a0 = sky();
    const c0 = sky();
    const far = sky() < 0.7;
    const speed = far ? 0.012 : 0.035;
    const a = (((a0 + t * speed) % 1) + 1) % 1;
    const q = F.at((a - HEAD) / (1 - HEAD), (c0 - SIDE) / (1 - 2 * SIDE));
    const tw = 0.5 + 0.5 * Math.sin(t * (1.5 + sky() * 2) + i);
    p.fill(theme.ink, (far ? 0.25 : 0.5) * (0.5 + 0.5 * tw));
    p.circle(q.x, q.y, unit * (far ? 0.003 : 0.005));
  }

  // 音高的跑道：每個半音一條極淡的線，C 與 D 之類的自然音在尾端標名
  if (notes.length && hi - lo <= 40) {
    for (let m = Math.ceil(lo); m <= hi; m++) {
      const u = (m - lo) / (hi - lo);
      const a = F.at(-HEAD / (1 - HEAD), u);
      const b = F.at(1.02, u);
      const natural = [0, 2, 4, 5, 7, 9, 11].includes(((m % 12) + 12) % 12);
      p.stroke(theme.ink, hair, natural ? 0.07 : 0.035);
      p.line(a.x, a.y, b.x, b.y);
      if (natural && m % 12 !== 4 && m % 12 !== 11) {
        const q = F.at(0.985, u);
        p.noStroke();
        p.fill(theme.mute, 0.7);
        p.text(pcName(m), q.x, q.y - fs * (F.tall ? 1.2 : 0.5), {
          size: fs * 0.8,
          font: 'mono',
          align: 'center',
        });
      }
    }
  }

  // 時間尺：長邊外側每秒一格
  p.noStroke();
  p.fill(theme.mute, 0.8);
  for (let s = 1; s <= Math.floor(tail); s++) {
    const q = F.at(s / tail, F.tall ? 1.06 : -0.06);
    p.text(`−${s}s`, q.x, q.y - fs * 0.5, {
      size: fs * 0.75,
      font: 'mono',
      align: F.tall ? 'right' : 'center',
    });
  }

  // 尾巴取樣
  const [first, last] = ticksAlive(t, RATE, tail);
  const pts: { x: number; y: number; age: number; color: string; u: number; time: number }[] = [];
  for (let k = first; k <= last; k++) {
    const time = k / RATE;
    const u = heightAt(time);
    if (u === null) {
      pts.push({ x: Number.NaN, y: Number.NaN, age: 0, color, u: 0, time });
      continue;
    }
    const age = along(time);
    // 越舊的尾巴越往外飄一點，像被太陽風吹開
    const drift = Math.sin(time * 0.9 + ctx.seed) * 0.04 * age;
    const q = F.at(age, u + drift);
    pts.push({ x: q.x, y: q.y, age, color: colorAt(time), u, time });
  }
  const headU = heightAt(t);
  if (headU !== null) {
    const q = F.at(0, headU);
    pts.push({ x: q.x, y: q.y, age: 0, color, u: headU, time: t });
  }

  // 離子尾：從現在的頭筆直拖到底的一道淡光，寬窄跟著高頻
  if (headU !== null) {
    const hiBand = spectrum ? bandSeries(spectrum, 4000, 16000) : null;
    const air = hiBand && spectrum ? Math.min(1, smoothAt(hiBand, spectrum.fps, t, 0.3) * 2) : 0.4;
    const ion = theme.noteColors[8] ?? theme.ink;
    p.blend(theme.glow ? 'add' : 'multiply');
    for (let k = 1; k <= 14; k++) {
      const a = k / 14;
      const q = F.at(a * 1.05, headU);
      p.haze(
        q.x,
        q.y,
        unit * (0.05 + 0.1 * a) * (0.7 + 0.6 * air),
        ion,
        (theme.glow ? 0.12 : 0.07) * (1 - a * 0.8),
      );
    }
    p.blend('normal');
    const end = F.at(1.05, headU);
    const start = F.at(0, headU);
    p.stroke(ion, hair, 0.35);
    p.line(start.x, start.y, end.x, end.y);
    p.noStroke();
  }

  // 塵尾的色暈：沿尾巴的幾團，越舊越大越淡
  p.blend(theme.glow ? 'add' : 'multiply');
  for (let i = 0; i < pts.length; i += RATE / 3) {
    const q = pts[i];
    if (Number.isNaN(q.x)) continue;
    p.haze(
      q.x,
      q.y,
      unit * (0.08 + 0.22 * q.age),
      q.color,
      (theme.glow ? 0.16 : 0.1) * (1 - q.age),
    );
  }
  p.blend('normal');

  // 塵尾：寬而淡、中、細而亮三層
  const layers = [
    { width: (a: number) => unit * (0.012 + 0.07 * a), alpha: (a: number) => 0.16 * (1 - a) },
    { width: (a: number) => unit * (0.008 + 0.012 * a), alpha: (a: number) => 0.35 * (1 - a) },
    { width: (a: number) => unit * 0.004 * (1 - a) + hair * 0.6, alpha: (a: number) => 1 - a },
  ];
  p.noFill();
  for (const L of layers) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (Number.isNaN(a.x) || Number.isNaN(b.x)) continue;
      p.stroke(b.color, L.width(a.age), L.alpha(a.age));
      p.line(a.x, a.y, b.x, b.y);
    }
  }

  // 碎屑：沿尾巴散開的小點
  p.noStroke();
  const n = Math.round(sparkle * 3);
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i];
    if (Number.isNaN(q.x) || n === 0) continue;
    const rng = rngFor(ctx.seed, first + i);
    for (let j = 0; j < n; j++) {
      const spread = (rng() - 0.5) * unit * (0.02 + 0.22 * q.age);
      const back = rng() * unit * 0.03 * q.age;
      const dx = F.tall ? spread : -back;
      const dy = F.tall ? back : spread;
      p.fill(q.color, (1 - q.age) * (0.25 + 0.5 * rng()));
      p.circle(q.x + dx, q.y + dy, unit * (0.002 + 0.003 * rng()) * (1 - 0.5 * q.age));
    }
  }

  // kick：從那一刻的頭上噴出一把火花，跟著尾巴往後散
  if (sparkle > 0) {
    const drums = ctx.readings.drums;
    for (let i = 0; i < drums.length; i++) {
      const hit = drums[i];
      if (hit.time > t) break;
      if (hit.kind !== 'kick' || t - hit.time > tail * 0.6) continue;
      const u = heightAt(hit.time);
      if (u === null) continue;
      const age = along(hit.time);
      const c = colorAt(hit.time);
      const rng = rngFor(ctx.seed, 7000 + i);
      const fade = 1 - age / 0.6;
      for (let j = 0; j < Math.round(KICK_SPARKS * sparkle); j++) {
        const ang = rng() * Math.PI * 2;
        const r = unit * (0.02 + 0.12 * rng()) * Math.sqrt(age / 0.6);
        const q = F.at(age, u);
        const x = q.x + Math.cos(ang) * r;
        const y = q.y + Math.sin(ang) * r;
        if (theme.glow) {
          p.fill(c, fade * 0.25);
          p.circle(x, y, unit * 0.014);
        }
        p.fill(theme.glow ? theme.ink : c, fade);
        p.circle(x, y, unit * 0.004);
      }
    }
  }

  // 和弦換手的地方：尾巴上一道小刻痕，旁邊寫新和弦
  for (const c of chords) {
    if (c.time > t) break;
    const age = along(c.time);
    if (age > 1 || age < 0.02) continue;
    const u = heightAt(c.time);
    if (u === null) continue;
    const a = F.at(age, u - 0.05);
    const b = F.at(age, u + 0.05);
    p.stroke(theme.ink, hair, 0.6 * (1 - age));
    p.line(a.x, a.y, b.x, b.y);
    p.noStroke();
    p.fill(theme.ink, 0.75 * (1 - age));
    const lab = F.at(age, u + 0.065);
    p.text(c.name, lab.x, lab.y - fs * 0.5, { size: fs * 0.85, font: 'sans', align: 'left' });
  }

  // 彗星頭：大片彗髮 + 一顆亮核，旁邊註音名
  if (headU !== null) {
    const q = F.at(0, headU);
    p.blend(theme.glow ? 'add' : 'normal');
    p.haze(q.x, q.y, unit * 0.16, color, theme.glow ? 0.4 : 0.22);
    p.haze(q.x, q.y, unit * 0.05, theme.glow ? theme.ink : color, theme.glow ? 0.5 : 0.35);
    p.blend('normal');
    p.noStroke();
    if (theme.glow) p.glow(color, unit * 0.03);
    p.fill(color, 0.45);
    p.circle(q.x, q.y, unit * 0.04);
    p.fill(theme.ink);
    p.circle(q.x, q.y, unit * 0.016);
    if (theme.glow) p.noGlow();
    const now = notes.length ? bassAt(notes, t, true) : null;
    if (now) {
      p.fill(theme.ink, 0.9);
      p.text(midiName(now.midi), q.x + unit * 0.04, q.y - unit * 0.05, {
        size: fs * 1.2,
        font: 'mono',
        align: 'left',
      });
    }
  }
}

function readouts(ctx: LookContext): Readout[] {
  const notes = ctx.readings.bass ?? [];
  const b = bassAt(notes, ctx.t, true);
  const c = chordAt(ctx.readings.chords ?? [], ctx.t);
  const [lo, hi] = pitchRange(notes);
  return [
    { label: 'BASS', value: b ? midiName(b.midi) : '—' },
    { label: 'CHORD', value: c?.name ?? '—' },
    { label: 'RANGE', value: notes.length ? `${midiName(lo + 2)}–${midiName(hi - 2)}` : '—' },
    { label: 'TIME', value: formatTime(ctx.t) },
  ];
}

/** 彗星：bass 音高是彗星在短邊上的位置，在長格子裡往上飛、拖著幾秒的尾巴到底；尾巴的顏色記著當時的和弦，kick 噴火花；沒有 bass 讀數就用低頻能量。 */
export const cometLook: Look = {
  id: 'comet',
  number: 22,
  name: '彗星',
  listens: ['bass', 'chords', 'spectrum'],
  params,
  draw,
  readouts,
};

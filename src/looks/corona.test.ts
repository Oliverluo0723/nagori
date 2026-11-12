import { expect, test } from 'vitest';
import { tempoMapFromBpm } from '../analysis/tempo';
import type { Readings, Spectrum } from '../analysis/types';
import { darkGlow, paperInk } from '../compose/themes';
import { coronaLook } from './corona';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';
import type { LookContext } from './types';

const tempo = tempoMapFromBpm(120); // 半拍 0.25 秒
const BINS = 8;
function flat(seconds: number, value: number, fps = 20): Spectrum {
  const frameCount = seconds * fps;
  return {
    fps,
    bins: BINS,
    minHz: 30,
    maxHz: 16000,
    frames: new Float32Array(frameCount * BINS).fill(value),
    frameCount,
  };
}
const W = 1080;
const H = 1920;
const ctx = (t: number, s?: Spectrum, theme = darkGlow): LookContext => ({
  t,
  w: W,
  h: H,
  readings: { duration: 40, tempo, drums: [], roles: [], spectrum: s } as Readings,
  theme,
  params: {},
  seed: 1,
  label: '11 CORONA',
});
const strokeColorAt = (p: RecordingPainter, index: number) => {
  let color: unknown;
  for (let i = 0; i < index; i++) if (p.ops[i].op === 'stroke') color = p.ops[i].args[0];
  return color;
};

test('deterministic', () => {
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  coronaLook.draw(a, ctx(4, flat(40, 0.5)));
  coronaLook.draw(b, ctx(4, flat(40, 0.5)));
  expect(a.ops).toEqual(b.ops);
});

test('without spectrum: three inner rings and the label, no rays', () => {
  const p = new RecordingPainter();
  coronaLook.draw(p, ctx(4, undefined, paperInk));
  expect(p.ops.filter((o) => o.op === 'circle')).toHaveLength(3);
  expect(p.ops.filter((o) => o.op === 'line')).toHaveLength(0);
  expect(p.ops.some((o) => o.op === 'text' && o.args[0] === '11 CORONA')).toBe(true);
  expect(p.ops.some((o) => o.op === 'glow')).toBe(false);
});

test('one accent ray per half beat up to t, starting on the inner ring', () => {
  const p = new RecordingPainter();
  coronaLook.draw(p, ctx(4, flat(40, 0.5)));
  const lines = p.ops.filter((o) => o.op === 'line');
  const accentRays = lines.filter((o) => strokeColorAt(p, p.ops.indexOf(o)) === darkGlow.accent);
  // t = 4 秒 → 0, 0.25 … 3.75 共 16 根：15 根強調色加 1 根墨色指針
  expect(accentRays).toHaveLength(15);
  const [x1, y1] = accentRays[0].args as number[];
  const r = Math.hypot(x1 - W / 2, y1 - H / 2);
  const inner = Math.min(W, H) * 0.14;
  expect(r).toBeCloseTo(inner, 0);
  // 最新那根是墨色指針，從內圈裡面伸出來（高頻射線也是墨色，但從內圈起）
  const needle = lines[lines.length - 1];
  expect(strokeColorAt(p, p.ops.indexOf(needle))).toBe(darkGlow.ink);
  const [nx, ny] = needle.args as number[];
  expect(Math.hypot(nx - W / 2, ny - H / 2)).toBeCloseTo(inner * 0.6, 0);
});

test('louder makes longer rays', () => {
  const quiet = new RecordingPainter();
  const loud = new RecordingPainter();
  coronaLook.draw(quiet, ctx(1, flat(40, 0.2)));
  coronaLook.draw(loud, ctx(1, flat(40, 0.8)));
  const len = (p: RecordingPainter) => {
    const o = p.ops.find((o) => o.op === 'line');
    const [x1, y1, x2, y2] = (o?.args ?? [0, 0, 0, 0]) as number[];
    return Math.hypot(x2 - x1, y2 - y1);
  };
  expect(len(loud)).toBeGreaterThan(len(quiet));
});

test('registry exposes corona as number 11', () => {
  expect(looks.corona).toBe(coronaLook);
  expect(coronaLook).toMatchObject({ id: 'corona', number: 11, listens: ['spectrum', 'tempo'] });
});

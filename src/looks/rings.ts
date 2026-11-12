import { positionAt, timeOfBar } from '../analysis/tempo';
import type { Painter } from './painter/painter';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'windowBars', label: '視窗小節數', min: 1, max: 8, default: 2 },
  { key: 'fadeSeconds', label: '淡出秒數', min: 0.5, max: 4, default: 1.5 },
];

const NOW_X = 0.62;

function num(ctx: LookContext, key: string): number {
  const v = ctx.params[key];
  if (typeof v === 'number') return v;
  return params.find((p) => p.key === key)?.default ?? 0;
}

function barSeconds(ctx: LookContext): number {
  const { tempo } = ctx.readings;
  const bar = positionAt(tempo, ctx.t).bar;
  const seconds = timeOfBar(tempo, bar + 1) - timeOfBar(tempo, bar);
  return seconds > 0 ? seconds : 2;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const windowBars = num(ctx, 'windowBars');
  const fadeSeconds = num(ctx, 'fadeSeconds');
  const axisY = h * 0.5;
  const nowX = w * NOW_X;
  const pxPerSec = w / (windowBars * barSeconds(ctx));

  p.background(theme.paper);

  // 時間軸
  p.noFill();
  p.stroke(theme.line, h * 0.0015);
  p.line(0, axisY, w, axisY);

  // hits，由舊到新（readings.drums 已依時間排序）
  for (const hit of ctx.readings.drums) {
    const age = t - hit.time;
    if (age < 0 || age >= fadeSeconds) continue;
    const x = nowX - age * pxPerSec;
    if (x < -w * 0.1 || x > w * 1.1) continue;
    const grow = 1 - Math.exp(-age * 9);
    const alpha = 1 - age / fadeSeconds;

    if (hit.kind === 'kick') {
      const d = h * (0.03 + 0.05 * hit.velocity) * grow;
      p.noStroke();
      if (theme.glow) p.glow(theme.accent, h * 0.02);
      p.fill(theme.accent, alpha);
      p.circle(x, axisY, d);
      if (theme.glow) p.noGlow();
    } else if (hit.kind === 'snare') {
      const d = h * (0.04 + 0.06 * hit.velocity) * grow;
      p.noFill();
      p.stroke(theme.ink, h * 0.0025, alpha);
      p.circle(x, axisY, d);
    } else {
      const y0 = axisY - h * 0.03;
      p.stroke(theme.ink, h * 0.0015, alpha);
      p.line(x, y0, x, y0 - h * 0.02 * grow);
    }
  }

  // now 線
  p.noFill();
  p.stroke(theme.ink, h * 0.002);
  p.line(nowX, axisY - h * 0.06, nowX, axisY + h * 0.06);

  // 小標
  if (ctx.label) {
    p.noStroke();
    p.fill(theme.mute);
    p.text(ctx.label, w * 0.03, h * 0.04, { size: h * 0.012, font: 'mono', align: 'left' });
  }
}

/** Hit 圓環：時間軸上每個 hit 落下一個圓，kick 實心、snare 空心、hat 短線。 */
export const ringsLook: Look = {
  id: 'rings',
  number: 6,
  name: 'Hit 圓環',
  listens: ['drums', 'tempo'],
  params,
  draw,
};

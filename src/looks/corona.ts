import { beatTimes } from './mesh';
import type { Painter } from './painter/painter';
import { bandSeries, drawLabel, energySeries, meanOver, paramNum, printedBeat } from './sheet';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'gain', label: '射線長度', min: 0.5, max: 3, default: 1.8 },
  { key: 'perBeat', label: '每拍射線', min: 1, max: 4, default: 2 },
];

const INNER = 0.14; // 射線起點半徑（短邊倍數）
const LENGTH = 0.3; // 滿能量的射線長度
const RINGS = [0.11, 0.12, 0.13];

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const { tempo, spectrum, duration } = ctx.readings;
  const gain = paramNum(ctx, params, 'gain');
  const perBeat = Math.max(1, Math.round(paramNum(ctx, params, 'perBeat')));
  const cx = w / 2;
  const cy = h / 2;
  const unit = Math.min(w, h);
  const inner = unit * INNER;
  const total = duration > 0 ? duration : 1;
  const beat = printedBeat(tempo, t);

  p.background(theme.paper);

  // 內圈
  p.noFill();
  p.stroke(theme.line, h * 0.0008);
  for (const r of RINGS) p.circle(cx, cy, unit * r * 2);

  if (spectrum) {
    const times = beatTimes(tempo, Math.min(t, total), perBeat);
    const energy = energySeries(spectrum);
    const high = bandSeries(spectrum, 4000, 16000);
    const angleOf = (time: number) => (time / total) * Math.PI * 2 - Math.PI / 2;
    const ray = (angle: number, from: number, to: number) =>
      p.line(
        cx + Math.cos(angle) * from,
        cy + Math.sin(angle) * from,
        cx + Math.cos(angle) * to,
        cy + Math.sin(angle) * to,
      );

    for (let j = 0; j < times.length; j++) {
      const from = times[j];
      const to = j + 1 < times.length ? times[j + 1] : Math.min(t, total);
      const e = Math.min(1, meanOver(energy, spectrum.fps, from, Math.max(from, to)) * gain);
      const hi = Math.min(1, meanOver(high, spectrum.fps, from, Math.max(from, to)) * gain * 1.4);
      const angle = angleOf(from);
      const current = from >= t - beat / perBeat;
      if (current) {
        // 正在印的那根是墨色指針
        p.stroke(theme.ink, h * 0.0012);
        ray(angle, inner * 0.6, inner + unit * LENGTH * Math.max(e, 0.15));
        continue;
      }
      if (theme.glow) p.glow(theme.accent, h * 0.003);
      p.stroke(theme.accent, h * 0.0009);
      ray(angle, inner, inner + unit * LENGTH * e);
      if (theme.glow) p.noGlow();
      if (hi > 0.02) {
        p.stroke(theme.ink, h * 0.0005, 0.6);
        ray(angle, inner, inner + unit * LENGTH * hi);
      }
    }
  }

  drawLabel(p, ctx);
}

/** 日冕：整首歌繞一圈，每半拍一根射線，長度是那一刻的能量，高頻另畫一根細的。 */
export const coronaLook: Look = {
  id: 'corona',
  number: 11,
  name: '日冕',
  listens: ['spectrum', 'tempo'],
  params,
  draw,
};

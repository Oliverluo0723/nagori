import { tempoMapFromBpm } from '../../src/analysis/tempo';
import type { Readings, Spectrum } from '../../src/analysis/types';
import { darkGlow } from '../../src/compose/themes';
import type { RecordingPainter } from '../../src/looks/painter/recording';
import type { LookContext } from '../../src/looks/types';

/** 每幀每個 bin 都是 fill(bin, frame) 的頻譜。 */
export function spectrumWith(
  seconds: number,
  fill: (bin: number, frame: number) => number,
  opts: { fps?: number; bins?: number } = {},
): Spectrum {
  const fps = opts.fps ?? 10;
  const bins = opts.bins ?? 16;
  const frameCount = Math.round(seconds * fps);
  const frames = new Float32Array(frameCount * bins);
  for (let f = 0; f < frameCount; f++)
    for (let b = 0; b < bins; b++) frames[f * bins + b] = fill(b, f);
  return { fps, bins, minHz: 30, maxHz: 16000, frames, frameCount };
}

export const flatSpectrum = (seconds: number, value: number) => spectrumWith(seconds, () => value);

export function makeCtx(
  t: number,
  readings: Partial<Readings>,
  extra: Partial<Pick<LookContext, 'theme' | 'params' | 'seed' | 'label' | 'w' | 'h'>> = {},
): LookContext {
  return {
    t,
    w: extra.w ?? 1080,
    h: extra.h ?? 1920,
    readings: { duration: 60, tempo: tempoMapFromBpm(120), drums: [], roles: [], ...readings },
    theme: extra.theme ?? darkGlow,
    params: extra.params ?? {},
    seed: extra.seed ?? 1,
    label: extra.label ?? 'LOOK',
  };
}

export const opsOf = (p: RecordingPainter, op: string) => p.ops.filter((o) => o.op === op);
export const hasText = (p: RecordingPainter, s: string) =>
  p.ops.some((o) => o.op === 'text' && o.args[0] === s);

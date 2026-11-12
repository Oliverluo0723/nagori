import { expect, test } from 'vitest';
import { tempoMapFromBpm } from '../analysis/tempo';
import type { BassNote, ChordEvent, DrumHit, Readings, Spectrum } from '../analysis/types';
import { darkGlow } from '../compose/themes';
import { RecordingPainter } from './painter/recording';
import { mulberry32 } from './prng';
import { looks } from './registry';

/**
 * canvas 的 shadowBlur 每個圖形都要在 GPU 上模糊一次。實測：一幀幾百個 glow 圖形
 * 會從 120 fps 掉到 15 fps（噴泉、萬花筒、日冕），而 JS 端只花 1 ms，量 JS 時間看不出來。
 * 這個測試用接近 KILL LOVE 密度的讀數（5 分鐘、約 2000 個 hit），檢查每個 look
 * 在黑底主題下一幀發出的「在 glow 狀態下畫的圖形」數量不超過預算。
 */
const GLOW_SHAPE_BUDGET = 40;
const SHAPES = new Set(['circle', 'line', 'rect', 'ellipse', 'polyline', 'wedge', 'text']);

function denseReadings(): Readings {
  const rng = mulberry32(7);
  const duration = 288;
  const fps = 50;
  const bins = 64;
  const frameCount = duration * fps;
  const frames = new Float32Array(frameCount * bins);
  for (let i = 0; i < frames.length; i++) frames[i] = 0.5 + 0.45 * rng();
  const spectrum: Spectrum = { fps, bins, minHz: 30, maxHz: 16000, frames, frameCount };
  const kinds: DrumHit['kind'][] = ['kick', 'hat', 'snare', 'hat'];
  const drums: DrumHit[] = [];
  // 128 BPM 的 16 分音符格，每格 85% 機率有 hit
  const step = 60 / 128 / 4;
  for (let i = 0; i * step < duration; i++) {
    if (rng() < 0.85)
      drums.push({ time: i * step, kind: kinds[i % 4], velocity: 0.6 + 0.4 * rng() });
  }
  const bass: BassNote[] = [];
  const chords: ChordEvent[] = [];
  for (let s = 0; s < duration; s += 1.875) {
    bass.push({ time: s, duration: 1.5, midi: 36 + Math.floor(rng() * 12), bends: [] });
    chords.push({ time: s, duration: 1.875, root: 2, name: 'D', notes: [2, 6, 9] });
  }
  return { duration, tempo: tempoMapFromBpm(128), drums, roles: [], spectrum, bass, chords };
}

const readings = denseReadings();

for (const look of Object.values(looks)) {
  test(`${look.id}: at most ${GLOW_SHAPE_BUDGET} shapes drawn under glow per frame`, () => {
    let worst = 0;
    for (const t of [10.03, 45.2, 100.5, 160.01, 230.7]) {
      const p = new RecordingPainter();
      const params: Record<string, number> = {};
      for (const d of look.params) params[d.key] = d.default;
      look.draw(p, { t, w: 540, h: 960, readings, theme: darkGlow, params, seed: 1, label: 'X' });
      let glowing = false;
      let n = 0;
      for (const op of p.ops) {
        if (op.op === 'glow') glowing = true;
        else if (op.op === 'noGlow') glowing = false;
        else if (glowing && SHAPES.has(op.op)) n++;
      }
      worst = Math.max(worst, n);
    }
    expect(worst).toBeLessThanOrEqual(GLOW_SHAPE_BUDGET);
  });
}

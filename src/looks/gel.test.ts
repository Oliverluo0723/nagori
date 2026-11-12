import { expect, test } from 'vitest';
import { makeCtx, opsOf, spectrumWith } from '../../test/fixtures/looks';
import type { DrumHit } from '../analysis/types';
import { darkGlow } from '../compose/themes';
import { gelLook } from './gel';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';

const W = 1080;
const H = 1920;
/** 120 BPM 一小節 2 秒：偶數小節全響、奇數小節安靜。 */
const everyOtherBar = () =>
  spectrumWith(60, (_b, f) => (Math.floor(f / 20) % 2 === 0 ? 0.9 : 0.1), { fps: 10 });

test('deterministic', () => {
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  gelLook.draw(a, makeCtx(20, { spectrum: everyOtherBar() }));
  gelLook.draw(b, makeCtx(20, { spectrum: everyOtherBar() }));
  expect(a.ops).toEqual(b.ops);
});

test('seven full-height lanes fill the cell even before anything is printed', () => {
  const p = new RecordingPainter();
  gelLook.draw(p, makeCtx(0, {}));
  const lanes = opsOf(p, 'rect');
  expect(lanes).toHaveLength(7);
  for (const r of lanes) expect(r.args[3]).toBe(H);
  expect(lanes[0].args[0]).toBeCloseTo(0);
  expect((lanes[6].args[0] as number) + (lanes[6].args[2] as number)).toBeCloseTo(W);
});

test('a band only for loud bars, printed down to t, the newest one in accent', () => {
  const p = new RecordingPainter();
  gelLook.draw(p, makeCtx(9, { spectrum: everyOtherBar() }));
  // 0–9 秒：第 0、2、4 小節響（第 4 小節正在印）→ 每條泳道 3 條帶，每條帶兩個 rect（暈 + 實）以上
  const bands = opsOf(p, 'rect').slice(7);
  expect(bands.length).toBeGreaterThanOrEqual(7 * 3 * 2);
  for (const r of bands) expect(r.args[1] as number).toBeLessThan((9 / 60) * H);
  expect(opsOf(p, 'fill').map((o) => o.args[0])).toContain(darkGlow.accent);
});

test('kicks are dots in the first lane; later kicks wait', () => {
  const drums: DrumHit[] = [
    { time: 1, kind: 'kick', velocity: 1 },
    { time: 2, kind: 'snare', velocity: 1 },
    { time: 30, kind: 'kick', velocity: 1 },
  ];
  const p = new RecordingPainter();
  gelLook.draw(p, makeCtx(10, { drums }));
  // 一顆 kick + 筆頭兩個圓
  const dots = opsOf(p, 'circle');
  expect(dots).toHaveLength(3);
  expect(dots[0].args[0] as number).toBeLessThan(W / 7);
});

test('registry exposes gel as number 18', () => {
  expect(looks.gel).toBe(gelLook);
  expect(gelLook).toMatchObject({ id: 'gel', number: 18 });
});

import { expect, test } from 'vitest';
import { flatSpectrum, hasText, makeCtx, opsOf, spectrumWith } from '../../test/fixtures/looks';
import { darkGlow, paperInk } from '../compose/themes';
import { bandCentre, bandEdges, CHAKRA_BANDS, chakraLook, formatHz, swatchColor } from './chakra';
import { RecordingPainter } from './painter/recording';
import { mulberry32 } from './prng';
import { looks } from './registry';

/** 每幀每 bin 都是亂數（固定種子）的頻譜：各帶都有起伏。 */
const noisy = () => {
  const rng = mulberry32(5);
  return spectrumWith(60, () => rng(), { fps: 20, bins: 64 });
};

/** 每個 rect 配上當時的 fill。 */
function rects(p: RecordingPainter) {
  const out: { color: string; alpha: number; y: number; w: number }[] = [];
  let fill = { color: '', alpha: 1 };
  for (const o of p.ops) {
    if (o.op === 'fill') fill = { color: o.args[0] as string, alpha: (o.args[1] as number) ?? 1 };
    if (o.op === 'rect') out.push({ ...fill, y: o.args[1] as number, w: o.args[2] as number });
  }
  return out;
}

test('registry exposes chakra as number 37', () => {
  expect(looks.chakra).toBe(chakraLook);
  expect(chakraLook).toMatchObject({ id: 'chakra', number: 37, name: '脈輪' });
});

test('deterministic', () => {
  const s = noisy();
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  chakraLook.draw(a, makeCtx(12.3, { spectrum: s }));
  chakraLook.draw(b, makeCtx(12.3, { spectrum: s }));
  expect(a.ops).toEqual(b.ops);
});

test('18 log bands from 40 Hz to 16 kHz; centres format as Hz / kHz', () => {
  expect(bandEdges(0)[0]).toBeCloseTo(40);
  expect(bandEdges(CHAKRA_BANDS - 1)[1]).toBeCloseTo(16000);
  for (let i = 1; i < CHAKRA_BANDS; i++) expect(bandEdges(i)[0]).toBeCloseTo(bandEdges(i - 1)[1]);
  expect(formatHz(bandCentre(0))).toBe('47 Hz');
  expect(formatHz(bandCentre(CHAKRA_BANDS - 1))).toBe('13.5 kHz');
  expect(formatHz(999)).toBe('999 Hz');
});

test('a column of 18 swatches, air at the top and sub at the bottom, every one a theme colour', () => {
  const p = new RecordingPainter();
  chakraLook.draw(p, makeCtx(12.3, { spectrum: noisy() }));
  const r = rects(p);
  expect(r).toHaveLength(CHAKRA_BANDS);
  // 畫的順序是 sub → air，所以 y 要一路往上
  for (let i = 1; i < r.length; i++) expect(r[i].y).toBeLessThan(r[i - 1].y);
  for (let i = 0; i < r.length; i++) {
    expect(r[i].color).toBe(swatchColor(darkGlow, i));
    expect(darkGlow.noteColors).toContain(r[i].color);
  }
  // 鄰帶顏色不同
  for (let i = 1; i < r.length; i++) expect(r[i].color).not.toBe(r[i - 1].color);
  // 最亮的那一格放大 1.3 倍，其他一樣大
  const widths = r.map((x) => x.w);
  const base = Math.min(...widths);
  expect(widths.filter((x) => x > base * 1.2)).toHaveLength(1);
  expect(hasText(p, 'air')).toBe(true);
  expect(hasText(p, 'sub')).toBe(true);
  expect(hasText(p, '47 Hz')).toBe(true);
});

test('a band louder than usual is brighter; the oval hazes add on dark', () => {
  // 前 10 秒 bass 小聲、之後大聲（bin 0..3 ≈ 30–160 Hz）
  const s = spectrumWith(60, (bin, f) => (bin < 4 ? (f < 200 ? 0.2 : 0.9) : 0.5), { fps: 20 });
  const alphaAt = (t: number) => {
    const p = new RecordingPainter();
    chakraLook.draw(p, makeCtx(t, { spectrum: s }));
    return rects(p)[0].alpha;
  };
  expect(alphaAt(30)).toBeGreaterThan(alphaAt(5));
  const p = new RecordingPainter();
  chakraLook.draw(p, makeCtx(30, { spectrum: s }));
  // 八團橢圓光 + 最亮那格背後一團
  expect(opsOf(p, 'haze')).toHaveLength(9);
  expect(opsOf(p, 'blend').some((o) => o.args[0] === 'add')).toBe(true);
  expect(opsOf(p, 'glow')).toHaveLength(0);
});

test('no spectrum still draws the oval and a dim column; paper theme multiplies without glow', () => {
  const none = new RecordingPainter();
  chakraLook.draw(none, makeCtx(5, {}, { theme: paperInk }));
  expect(none.ops[0]).toEqual({ op: 'background', args: [paperInk.paper] });
  const r = rects(none);
  expect(r).toHaveLength(CHAKRA_BANDS);
  for (const x of r) expect(x.alpha).toBeCloseTo(0.35);
  expect(opsOf(none, 'haze')).toHaveLength(8);
  expect(opsOf(none, 'glow')).toHaveLength(0);
  expect(opsOf(none, 'blend').some((o) => o.args[0] === 'multiply')).toBe(true);
  expect(opsOf(none, 'blend').some((o) => o.args[0] === 'add')).toBe(false);
  const paper = new RecordingPainter();
  chakraLook.draw(paper, makeCtx(12.3, { spectrum: noisy() }, { theme: paperInk }));
  expect(opsOf(paper, 'glow')).toHaveLength(0);
});

test('readouts: BRIGHTEST / LOWS / HIGHS', () => {
  // 低頻最響（64 bin 時 bin 0..5 ≈ 30–52 Hz，落在第 0 帶）
  const low = spectrumWith(60, (bin) => (bin < 6 ? 0.9 : 0.1), { bins: 64 });
  const r = chakraLook.readouts?.(makeCtx(10, { spectrum: low })) ?? [];
  expect(r[0]).toEqual({ label: 'BRIGHTEST', value: '47 Hz' });
  expect(r[1].label).toBe('LOWS');
  expect(r[2].label).toBe('HIGHS');
  expect(Number.parseInt(r[1].value, 10)).toBeGreaterThan(Number.parseInt(r[2].value, 10));
  // 平的頻譜：中心 < 250 Hz 的 6 帶、> 2 kHz 的 6 帶，各 6 / 18
  const flat = chakraLook.readouts?.(makeCtx(10, { spectrum: flatSpectrum(60, 0.5) })) ?? [];
  expect(flat[1]).toEqual({ label: 'LOWS', value: '33 %' });
  expect(flat[2]).toEqual({ label: 'HIGHS', value: '33 %' });
  const none = chakraLook.readouts?.(makeCtx(10, {})) ?? [];
  expect(none).toEqual([
    { label: 'BRIGHTEST', value: '—' },
    { label: 'LOWS', value: '0 %' },
    { label: 'HIGHS', value: '0 %' },
  ]);
});

import { expect, test } from 'vitest';
import { makeCtx, opsOf, spectrumWith } from '../../test/fixtures/looks';
import { paperInk } from '../compose/themes';
import { RecordingPainter } from './painter/recording';
import { eighthAt, PEG_BANDS, pegboardLook, rowsFor } from './pegboard';
import { mulberry32 } from './prng';
import { readoutsFor } from './readouts';
import { looks } from './registry';

/** 每幀每 bin 都是亂數（固定種子）的頻譜：各帶都有起伏，才有亮有暗。 */
const noisy = () => {
  const rng = mulberry32(3);
  return spectrumWith(60, () => rng(), { fps: 20, bins: 64 });
};

/** 每個 circle 配上當時的 fill。 */
function circles(p: RecordingPainter) {
  const out: { color: string; alpha: number; y: number; d: number }[] = [];
  let fill = { color: '', alpha: 1 };
  for (const o of p.ops) {
    if (o.op === 'fill') fill = { color: o.args[0] as string, alpha: (o.args[1] as number) ?? 1 };
    if (o.op === 'circle') out.push({ ...fill, y: o.args[1] as number, d: o.args[2] as number });
  }
  return out;
}

test('registry exposes pegboard as number 27', () => {
  expect(looks.pegboard).toBe(pegboardLook);
  expect(pegboardLook).toMatchObject({ id: 'pegboard', number: 27, name: '釘板' });
});

test('deterministic', () => {
  const s = noisy();
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  pegboardLook.draw(a, makeCtx(12.3, { spectrum: s }));
  pegboardLook.draw(b, makeCtx(12.3, { spectrum: s }));
  expect(a.ops).toEqual(b.ops);
});

test('rows: the param is a floor; a tall cell adds rows so pegs stay round', () => {
  expect(rowsFor(makeCtx(0, {}, { w: 1080, h: 600 }))).toBe(14);
  expect(rowsFor(makeCtx(0, {}, { w: 1080, h: 1920 }))).toBe(32);
  expect(rowsFor(makeCtx(0, {}, { w: 1080, h: 600, params: { rows: 20 } }))).toBe(20);
});

test('no spectrum: one empty peg per band per row', () => {
  const p = new RecordingPainter();
  const ctx = makeCtx(5, {}, { theme: paperInk });
  pegboardLook.draw(p, ctx);
  expect(opsOf(p, 'circle')).toHaveLength(PEG_BANDS * rowsFor(ctx));
});

test('the page fills bottom-up: early in a page only the bottom rows are lit', () => {
  const s = noisy();
  // 120 BPM：8 分音符 0.25 s；t = 0.9 是序號 3，新頁的 0..3 列
  const ctx = makeCtx(0.9, { spectrum: s }, { w: 1080, h: 600 });
  expect(eighthAt(ctx.readings.tempo, 0.9)).toBe(3);
  const p = new RecordingPainter();
  pegboardLook.draw(p, ctx);
  const rows = rowsFor(ctx);
  const ch = 600 / rows;
  const lit = circles(p).filter((c) => c.color !== ctx.theme.line);
  expect(lit.length).toBeGreaterThan(0);
  for (const c of lit) expect(c.y).toBeGreaterThan(600 - ch * 4);
  // 下一頁剛開始（序號 rows + 1）：上一頁其餘的列淡淡留著，都在新寫的兩列上面
  const later = new RecordingPainter();
  const t2 = (rows + 1) * 0.25 + 0.1;
  pegboardLook.draw(later, makeCtx(t2, { spectrum: s }, { w: 1080, h: 600 }));
  const ghosts = circles(later).filter((c) => c.color !== ctx.theme.line && c.alpha < 0.5);
  expect(ghosts.length).toBeGreaterThan(0);
  for (const c of ghosts) expect(c.y).toBeLessThan(600 - ch * 2 + 1);
});

test('readouts: STEP of the bar, LIT of 18, ROWS in eighths', () => {
  const r = readoutsFor(pegboardLook, makeCtx(0.9, { spectrum: noisy() }, { w: 1080, h: 600 }));
  expect(r.map((x) => x.label)).toEqual(['STEP', 'LIT', 'ROWS']);
  expect(r[0].value).toBe('4 / 8');
  expect(r[1].value).toMatch(/^\d+ of 18$/);
  expect(r[2].value).toBe('14 eighths');
});

import { expect, test } from 'vitest';
import { flatSpectrum, makeCtx, opsOf, spectrumWith } from '../../test/fixtures/looks';
import { darkGlow, paperInk } from '../compose/themes';
import { hatchLook } from './hatch';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';

// makeCtx：1080×1920、60 秒、120 BPM
const ROWS = 120;
const draw = (t: number, readings = {}, extra = {}) => {
  const p = new RecordingPainter();
  hatchLook.draw(p, makeCtx(t, readings, { params: { rows: ROWS }, ...extra }));
  return p;
};

/** 每條 line 配上畫它時的 stroke 顏色。 */
function coloredLines(p: RecordingPainter): { color: string; args: number[] }[] {
  const out: { color: string; args: number[] }[] = [];
  let color = '';
  for (const o of p.ops) {
    if (o.op === 'stroke') color = o.args[0] as string;
    else if (o.op === 'line') out.push({ color, args: o.args as number[] });
  }
  return out;
}
const linesIn = (p: RecordingPainter, color: string) =>
  coloredLines(p).filter((l) => l.color === color);
const BLUE = darkGlow.noteColors[9];
/** 已印的墨線（藍 + 最近兩拍的強調色），不算中軸那一條直線。 */
const inkLines = (p: RecordingPainter) =>
  coloredLines(p).filter(
    (l) => (l.color === BLUE || l.color === darkGlow.accent) && l.args[0] !== l.args[2],
  );

test('registry exposes hatch as number 31', () => {
  expect(looks.hatch).toBe(hatchLook);
  expect(hatchLook).toMatchObject({ id: 'hatch', number: 31, name: '水影排線' });
});

test('deterministic for a seed; another seed jitters the strokes', () => {
  const s = flatSpectrum(60, 0.5);
  const a = draw(30, { spectrum: s });
  const b = draw(30, { spectrum: s });
  const c = draw(30, { spectrum: s }, { seed: 9 });
  expect(a.ops).toEqual(b.ops);
  expect(c.ops).not.toEqual(a.ops);
});

test('every band stroke is mirrored across the centre axis', () => {
  const p = draw(60, { spectrum: flatSpectrum(60, 0.5) });
  const lines = inkLines(p);
  // 一列七個頻帶、左右各一條，沒有飛線（平的歌沒有特別響的列）
  expect(lines).toHaveLength(ROWS * 7 * 2);
  const key = (x0: number, y0: number, x1: number, y1: number) =>
    [x0, y0, x1, y1].map((v) => v.toFixed(4)).join(',');
  const set = new Set(lines.map((l) => key(l.args[0], l.args[1], l.args[2], l.args[3])));
  for (const l of lines) {
    const [x0, y0, x1, y1] = l.args;
    expect(set.has(key(1080 - x0, y0, 1080 - x1, y1))).toBe(true);
  }
});

test('loud rows are wide, quiet rows narrow; the loudest rows shoot stray strokes', () => {
  // 前半安靜、後半越來越大聲（60 秒、10 fps → 300 幀一半）
  const s = spectrumWith(60, (_b, f) => (f < 300 ? 0.1 : 0.5 + (0.4 * (f - 300)) / 300));
  const p = draw(60, { spectrum: s });
  const lines = inkLines(p);
  const width = (l: { args: number[] }) => Math.abs(l.args[2] - l.args[0]);
  const upper = lines.filter((l) => l.args[1] < 960).map(width);
  const lower = lines.filter((l) => l.args[1] >= 960).map(width);
  expect(Math.max(...upper)).toBeLessThan(1080 * 0.1);
  expect(Math.max(...lower)).toBeGreaterThan(1080 * 0.38);
  // 大聲的那半有飛線，所以比平的歌多
  expect(lines.length).toBeGreaterThan(ROWS * 7 * 2);
});

test('prints top to bottom: rows after t are faint mute, the last two beats are accent', () => {
  const s = flatSpectrum(60, 0.5);
  const half = draw(30, { spectrum: s });
  const mute = linesIn(half, darkGlow.mute);
  const blue = linesIn(half, BLUE);
  const accent = linesIn(half, darkGlow.accent);
  expect(mute.length).toBeGreaterThan(0);
  expect(blue.length).toBeGreaterThan(0);
  // 120 BPM 兩拍 = 1 秒：第 58 列到正在印的第 60 列
  expect(accent.length).toBe(3 * 7 * 2);
  // 未印的列都在下面、已印的都在上面
  expect(Math.min(...mute.map((l) => l.args[1]))).toBeGreaterThan(
    Math.max(...blue.map((l) => l.args[1])),
  );
  expect(opsOf(half, 'circle').length).toBeGreaterThan(0); // 筆頭
  const done = draw(60, { spectrum: s });
  expect(linesIn(done, darkGlow.mute)).toHaveLength(0);
  expect(opsOf(done, 'circle')).toHaveLength(0);
});

test('paper theme multiplies ink and never glows; dark theme adds light on a haze bed', () => {
  const s = flatSpectrum(60, 0.5);
  const paper = draw(30, { spectrum: s }, { theme: paperInk });
  expect(opsOf(paper, 'glow')).toHaveLength(0);
  expect(opsOf(paper, 'haze')).toHaveLength(0);
  expect(opsOf(paper, 'blend').some((o) => o.args[0] === 'multiply')).toBe(true);
  const dark = draw(30, { spectrum: s });
  expect(opsOf(dark, 'glow')).toHaveLength(0);
  expect(opsOf(dark, 'haze')).toHaveLength(1);
  expect(opsOf(dark, 'blend').some((o) => o.args[0] === 'add')).toBe(true);
});

test('no spectrum still draws the paper, the axis and the pen', () => {
  const p = draw(10, {}, { theme: paperInk });
  expect(p.ops[0]).toEqual({ op: 'background', args: [paperInk.paper] });
  expect(opsOf(p, 'line')).toHaveLength(1);
  expect(opsOf(p, 'circle')).toHaveLength(2);
});

test('readouts: PRINTED / PEN / TIME', () => {
  expect(hatchLook.readouts?.(makeCtx(45, { duration: 60 }))).toEqual([
    { label: 'PRINTED', value: '75 %' },
    { label: 'PEN', value: 'Hatch' },
    { label: 'TIME', value: '0:45' },
  ]);
});

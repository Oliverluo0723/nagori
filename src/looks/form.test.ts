import { expect, test } from 'vitest';
import { flatSpectrum, hasText, makeCtx, opsOf, spectrumWith } from '../../test/fixtures/looks';
import type { DrumHit } from '../analysis/types';
import { paperInk } from '../compose/themes';
import { formLook, joinSegments, marchingSquares, pointsAt } from './form';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';

/** 每 0.25 秒一個 hit，kick / hat / snare / hat 輪流。 */
function beats(seconds: number): DrumHit[] {
  const kinds: DrumHit['kind'][] = ['kick', 'hat', 'snare', 'hat'];
  const out: DrumHit[] = [];
  for (let i = 0; i * 0.25 < seconds; i++)
    out.push({ time: i * 0.25, kind: kinds[i % 4], velocity: 0.6 + 0.4 * ((i % 3) / 2) });
  return out;
}

test('registry exposes form as number 34', () => {
  expect(looks.form).toBe(formLook);
  expect(formLook).toMatchObject({ id: 'form', number: 34, name: '聲形等高線' });
});

test('deterministic for a seed; another seed moves the points', () => {
  const readings = { drums: beats(60), spectrum: flatSpectrum(60, 0.5) };
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  const c = new RecordingPainter();
  formLook.draw(a, makeCtx(20.3, readings));
  formLook.draw(b, makeCtx(20.3, readings));
  formLook.draw(c, makeCtx(20.3, readings, { seed: 9 }));
  expect(a.ops).toEqual(b.ops);
  expect(c.ops).not.toEqual(a.ops);
});

test('marching squares: a single peak in a 3×3 field gives a closed diamond', () => {
  const grid = [0, 0, 0, 0, 1, 0, 0, 0, 0];
  const segs = marchingSquares(grid, 3, 3, 0.5);
  expect(segs).toHaveLength(4);
  const lines = joinSegments(segs);
  expect(lines).toHaveLength(1);
  // 封閉環：首尾同一點，四個角在格邊中點
  const ring = lines[0];
  expect(ring).toHaveLength(5);
  expect(ring[0]).toEqual(ring[4]);
  const corners = ring.slice(0, 4).map((q) => `${q.x},${q.y}`);
  expect(new Set(corners)).toEqual(new Set(['1,0.5', '1.5,1', '1,1.5', '0.5,1']));
  // 高於最大值或低於最小值就沒有線
  expect(marchingSquares(grid, 3, 3, 1.5)).toHaveLength(0);
  expect(marchingSquares(grid, 3, 3, -1)).toHaveLength(0);
});

test('marching squares: a ramp gives one straight contour across the field', () => {
  // 每列值 = 列號，level 1.5 切在第 1 與第 2 列之間
  const grid = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2];
  const lines = joinSegments(marchingSquares(grid, 4, 3, 1.5));
  expect(lines).toHaveLength(1);
  for (const q of lines[0]) expect(q.y).toBeCloseTo(1.5);
  const xs = lines[0].map((q) => q.x);
  expect(Math.min(...xs)).toBe(0);
  expect(Math.max(...xs)).toBe(3);
});

test('points: the last n hits; weight decays with age and pulses in for the newest', () => {
  const drums = beats(60);
  const ctx = makeCtx(30, { drums });
  const pts = pointsAt(ctx, 30.05, 24);
  expect(pts).toHaveLength(24);
  // 剛敲下的那個還在漲，前一個已經滿
  expect(pts[23].weight).toBeLessThan(pts[22].weight);
  // 十秒前的 hit 比剛才的輕很多
  const old = pointsAt(ctx, 30.05, 48)[0];
  expect(old.weight).toBeLessThan(pts[22].weight * 0.3);
  // kick 落在左邊兩欄，snare 在中欄，hat 在右邊兩欄
  for (const q of pts) {
    const kind = drums[q.i].kind;
    if (kind === 'kick') expect(q.x).toBeLessThan(0.4);
    else if (kind === 'snare') {
      expect(q.x).toBeGreaterThan(0.4);
      expect(q.x).toBeLessThan(0.6);
    } else expect(q.x).toBeGreaterThan(0.6);
  }
  expect(pointsAt(ctx, 0, 24)).toHaveLength(1);
  expect(pointsAt(makeCtx(5, {}), 5, 24)).toHaveLength(0);
});

test('with hits: contours in pink, a dot per point, hazes for the tint, a blue dashed path', () => {
  const p = new RecordingPainter();
  formLook.draw(p, makeCtx(20.3, { drums: beats(60), spectrum: flatSpectrum(60, 0.5) }));
  const polylines = opsOf(p, 'polyline');
  // 四格小圖有 4 條輪廓；等高線至少十層各一條以上
  expect(polylines.length).toBeGreaterThan(4 + 10);
  // 24 個點 + 小圖的點
  expect(opsOf(p, 'circle').length).toBeGreaterThan(24);
  expect(opsOf(p, 'haze')).toHaveLength(6);
  expect(opsOf(p, 'blend').some((o) => o.args[0] === 'add')).toBe(true);
  expect(opsOf(p, 'glow')).toHaveLength(0);
  // 藍色虛線
  const blueStroke = p.ops.findIndex((o) => o.op === 'stroke' && o.args[0] === '#4f7cff');
  expect(blueStroke).toBeGreaterThan(-1);
  expect(opsOf(p, 'line').length).toBeGreaterThan(50);
});

test('fewer levels draw fewer contour polylines', () => {
  const readings = { drums: beats(60) };
  const many = new RecordingPainter();
  const few = new RecordingPainter();
  formLook.draw(many, makeCtx(20.3, readings, { params: { levels: 14 } }));
  formLook.draw(few, makeCtx(20.3, readings, { params: { levels: 4 } }));
  expect(opsOf(many, 'polyline').length).toBeGreaterThan(opsOf(few, 'polyline').length);
});

test('annotations: title, tempo, five column labels, study captions, the note', () => {
  const p = new RecordingPainter();
  formLook.draw(p, makeCtx(10, { drums: beats(60) }));
  expect(hasText(p, 'SOUND FORM')).toBe(true);
  expect(hasText(p, '♩ = 120')).toBe(true);
  for (const s of ['SUB', 'LOW', 'MID', 'HIGH', 'AIR']) expect(hasText(p, s)).toBe(true);
  for (const s of ['Hit points', 'Field', 'Merge', 'Sound form']) expect(hasText(p, s)).toBe(true);
  expect(hasText(p, 'FORM FINDING')).toBe(true);
  expect(hasText(p, 'Every hit pulls; the bands hold the form together.')).toBe(true);
});

test('empty readings still draw the frame; paper theme has no glow and multiplies', () => {
  const none = new RecordingPainter();
  formLook.draw(none, makeCtx(10, {}, { theme: paperInk }));
  expect(none.ops[0]).toEqual({ op: 'background', args: [paperInk.paper] });
  expect(hasText(none, 'SOUND FORM')).toBe(true);
  expect(opsOf(none, 'haze')).toHaveLength(0);
  expect(opsOf(none, 'glow')).toHaveLength(0);
  const paper = new RecordingPainter();
  formLook.draw(paper, makeCtx(20.3, { drums: beats(60) }, { theme: paperInk }));
  expect(opsOf(paper, 'glow')).toHaveLength(0);
  expect(opsOf(paper, 'blend').some((o) => o.args[0] === 'multiply')).toBe(true);
  expect(opsOf(paper, 'blend').some((o) => o.args[0] === 'add')).toBe(false);
});

test('readouts: POINTS / CONTOURS / STRONGEST / TEMPO', () => {
  const s = spectrumWith(60, (bin) => (bin < 2 ? 0.9 : 0.2));
  const r = formLook.readouts?.(makeCtx(20.3, { drums: beats(60), spectrum: s })) ?? [];
  expect(r).toEqual([
    { label: 'POINTS', value: '24' },
    { label: 'CONTOURS', value: '10' },
    { label: 'STRONGEST', value: 'sub' },
    { label: 'TEMPO', value: '120' },
  ]);
  // 只敲過一下、而且已經很久：點已經淡掉
  const sparse = formLook.readouts?.(
    makeCtx(40, { drums: [{ time: 1, kind: 'kick', velocity: 1 }] }, { params: { levels: 6 } }),
  );
  expect(sparse?.[0]).toEqual({ label: 'POINTS', value: '0' });
  expect(sparse?.[1]).toEqual({ label: 'CONTOURS', value: '6' });
  expect(sparse?.[2]).toEqual({ label: 'STRONGEST', value: '—' });
});

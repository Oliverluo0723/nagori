import { expect, test } from 'vitest';
import { hasText, makeCtx, opsOf } from '../../test/fixtures/looks';
import type { ChordEvent, DrumHit } from '../analysis/types';
import { darkGlow, paperInk } from '../compose/themes';
import { kaleidoLook } from './kaleido';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';

const kick: DrumHit = { time: 1, kind: 'kick', velocity: 1 };
const chords: ChordEvent[] = [{ time: 0, duration: 8, root: 2, name: 'D', notes: [2, 6, 9] }];
/** 每拍一圈，畫面上同時 6 圈 */
const RINGS = 6;
/** 一個 kick 6 顆粒子 × 6 份 × 正反鏡射 */
const KICK_DOTS = 6 * 6 * 2;

test('deterministic, registered as 21, paper never glows', () => {
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  kaleidoLook.draw(a, makeCtx(2.2, { drums: [kick], chords }));
  kaleidoLook.draw(b, makeCtx(2.2, { drums: [kick], chords }));
  expect(a.ops).toEqual(b.ops);
  expect(looks.kaleido).toBe(kaleidoLook);
  expect(kaleidoLook.number).toBe(21);
  for (const theme of [darkGlow, paperInk]) {
    const p = new RecordingPainter();
    kaleidoLook.draw(p, makeCtx(2.2, { drums: [kick], chords }, { theme }));
    expect(opsOf(p, 'glow')).toHaveLength(0);
  }
});

test('each particle appears 2 × segments times (halo + core on dark); old hits vanish', () => {
  const p = new RecordingPainter();
  kaleidoLook.draw(p, makeCtx(1.1, { drums: [kick] }, { params: { segments: 6 } }));
  expect(opsOf(p, 'circle')).toHaveLength(RINGS + KICK_DOTS * 2);
  const fills = p.ops.filter((o) => o.op === 'fill').map((o) => o.args[0]);
  expect(fills).toContain(darkGlow.accent);
  const paper = new RecordingPainter();
  kaleidoLook.draw(paper, makeCtx(1.1, { drums: [kick] }, { theme: paperInk }));
  expect(opsOf(paper, 'circle')).toHaveLength(RINGS + KICK_DOTS);
  const old = new RecordingPainter();
  kaleidoLook.draw(old, makeCtx(10, { drums: [kick] }));
  expect(opsOf(old, 'circle')).toHaveLength(RINGS);
});

test('a kick flies past the short side towards the corners of a tall box', () => {
  const p = new RecordingPainter();
  kaleidoLook.draw(p, makeCtx(3, { drums: [kick] }));
  let far = 0;
  for (const c of opsOf(p, 'circle')) {
    const [x, y] = c.args as number[];
    far = Math.max(far, Math.hypot(x - 540, y - 960));
  }
  expect(far).toBeGreaterThan(540);
});

test('soft colour washes and annotations: chord name and mirror count', () => {
  const p = new RecordingPainter();
  kaleidoLook.draw(p, makeCtx(2, { drums: [kick], chords }));
  expect(opsOf(p, 'haze').length).toBeGreaterThanOrEqual(6);
  expect(hasText(p, 'D')).toBe(true);
  expect(hasText(p, '× 6 mirror')).toBe(true);
});

test('readouts: MIRRORS / CHORD / PETALS / BEAT', () => {
  const r = kaleidoLook.readouts?.(makeCtx(1.1, { drums: [kick], chords })) ?? [];
  expect(r).toEqual([
    { label: 'MIRRORS', value: '6 × 2' },
    { label: 'CHORD', value: 'D' },
    { label: 'PETALS', value: String(KICK_DOTS) },
    { label: 'BEAT', value: '1.3' },
  ]);
});

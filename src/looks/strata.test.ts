import { expect, test } from 'vitest';
import { flatSpectrum, hasText, makeCtx, opsOf, spectrumWith } from '../../test/fixtures/looks';
import { paperInk } from '../compose/themes';
import { RecordingPainter } from './painter/recording';
import { looks } from './registry';
import { BANDS7 } from './sheet';
import { spots, strataLook } from './strata';

/** 每個圓盤：本體 + 5 層紋 + 3 圈細環 + 核 = 10 個 ellipse；腳下的火花雲再 1 個。 */
const DISCS = 6;
const ELLIPSES = DISCS * 10 + 1;

test('deterministic for a seed; another seed moves the spots', () => {
  const s = flatSpectrum(60, 0.5);
  const a = new RecordingPainter();
  const b = new RecordingPainter();
  const c = new RecordingPainter();
  strataLook.draw(a, makeCtx(10, { spectrum: s }));
  strataLook.draw(b, makeCtx(10, { spectrum: s }));
  strataLook.draw(c, makeCtx(10, { spectrum: s }, { seed: 9 }));
  expect(a.ops).toEqual(b.ops);
  expect(c.ops).not.toEqual(a.ops);
});

test('spots run head to foot along the long side, swaying across the short one', () => {
  const tall = spots(1, 1080, 1920);
  for (let i = 1; i < tall.length; i++) expect(tall[i].y).toBeGreaterThan(tall[i - 1].y);
  const xs = tall.map((q) => q.x);
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1080 * 0.3);
  const wide = spots(1, 1920, 1080);
  for (let i = 1; i < wide.length; i++) expect(wide[i].x).toBeGreaterThan(wide[i - 1].x);
});

test('six ringed discs with names and Hz notes, one thread, the sub as a spark cloud', () => {
  const p = new RecordingPainter();
  strataLook.draw(p, makeCtx(10, { spectrum: flatSpectrum(60, 0.5) }));
  expect(opsOf(p, 'ellipse')).toHaveLength(ELLIPSES);
  for (const b of BANDS7.slice(1)) expect(hasText(p, b.name)).toBe(true);
  expect(hasText(p, 'hits · sub')).toBe(true);
  expect(hasText(p, '500–2k Hz · 45')).toBe(true);
  // 一條線 + 每個圓盤兩段外弧與一個 C 字弧
  expect(opsOf(p, 'polyline')).toHaveLength(1 + DISCS * 3);
  expect(opsOf(p, 'glow')).toHaveLength(0);
});

test('a band louder than usual is a bigger disc; no spectrum still draws small discs', () => {
  // 前 10 秒小聲、之後大聲
  const s = spectrumWith(60, (_b, f) => (f < 100 ? 0.1 : 0.9));
  const size = (t: number) => {
    const p = new RecordingPainter();
    strataLook.draw(p, makeCtx(t, { spectrum: s }));
    return opsOf(p, 'ellipse')[0].args[2] as number;
  };
  expect(size(20)).toBeGreaterThan(size(5));
  const none = new RecordingPainter();
  strataLook.draw(none, makeCtx(10, {}, { theme: paperInk }));
  expect(opsOf(none, 'ellipse')).toHaveLength(ELLIPSES);
  expect(opsOf(none, 'glow')).toHaveLength(0);
});

test('a recent kick bursts extra sparks at the foot; an old one does not', () => {
  const kick = { time: 10, kind: 'kick' as const, velocity: 1 };
  const fresh = new RecordingPainter();
  strataLook.draw(fresh, makeCtx(10.1, { drums: [kick] }));
  const old = new RecordingPainter();
  strataLook.draw(old, makeCtx(12, { drums: [kick] }));
  expect(opsOf(fresh, 'line').length - opsOf(old, 'line').length).toBe(46);
});

test('readouts: LOUDEST / BASS / TURNS', () => {
  // 前 10 秒 bass 最響、之後換成 mids
  const s = spectrumWith(60, (bin, f) => {
    if (f < 100) return bin < 2 ? 0.5 : bin < 6 ? 0.9 : 0.1;
    return bin < 6 ? 0.1 : 0.9;
  });
  const bass = [{ time: 0, duration: 60, midi: 26, bends: [] }];
  const early = strataLook.readouts?.(makeCtx(5, { spectrum: s, bass })) ?? [];
  expect(early[0]).toEqual({ label: 'LOUDEST', value: 'bass' });
  expect(early[1]).toEqual({ label: 'BASS', value: 'D1' });
  expect(early[2]).toEqual({ label: 'TURNS', value: '0' });
  const late = strataLook.readouts?.(makeCtx(20, { spectrum: s, bass })) ?? [];
  expect(late[0].value).not.toBe('bass');
  expect(Number(late[2].value)).toBeGreaterThan(0);
});

test('registry exposes strata as number 16', () => {
  expect(looks.strata).toBe(strataLook);
  expect(strataLook).toMatchObject({ id: 'strata', number: 16 });
});

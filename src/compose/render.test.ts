import { Midi } from '@tonejs/midi';
import { expect, test } from 'vitest';
import { makeMidi } from '../../test/fixtures/midi';
import { buildTempoMap } from '../analysis/tempo';
import type { Readings } from '../analysis/types';
import { frameLayout } from './frame';
import { contentBox, DEFAULT_CANVAS, layoutCells, renderFrame } from './render';
import { RecordingSurfaceProvider } from './surface';
import type { Composition, LayoutNode } from './types';

const tempo = buildTempoMap(new Midi(makeMidi({ bpm: 120, tracks: [] })).header);
const readings: Readings = { duration: 60, tempo, drums: [], roles: [] };
const single: Composition = {
  aspect: { w: 9, h: 16 },
  root: { kind: 'cell', id: 'c1', lookId: 'rings', params: {} },
  themeId: 'darkGlow',
};

test('single cell: the look draws inside the plot box, the frame covers the whole cell', () => {
  const surfaces = new RecordingSurfaceProvider();
  renderFrame({ composition: single, t: 0, readings, surfaces, target: { w: 540, h: 960 } });
  const { plot } = frameLayout(540, 960, false);
  const look = surfaces.surfaces.get('c1');
  expect([look?.w, look?.h]).toEqual([plot.w, plot.h]);
  expect(look?.painter.ops[0]).toEqual({ op: 'background', args: ['#0f0f0f'] });
  const frame = surfaces.surfaces.get('c1:frame');
  expect([frame?.w, frame?.h]).toEqual([540, 960]);
});

test('layoutCells splits a row by ratio', () => {
  const root: LayoutNode = {
    kind: 'split',
    id: 's',
    direction: 'row',
    ratio: 0.25,
    a: { kind: 'cell', id: 'a', lookId: 'rings', params: {} },
    b: { kind: 'cell', id: 'b', lookId: 'rings', params: {} },
  };
  expect(layoutCells(root, 1000, 100)).toEqual([
    { id: 'a', x: 0, y: 0, w: 250, h: 100 },
    { id: 'b', x: 250, y: 0, w: 750, h: 100 },
  ]);
});

test('layoutCells splits a column by ratio', () => {
  const root: LayoutNode = {
    kind: 'split',
    id: 's',
    direction: 'column',
    ratio: 0.5,
    a: { kind: 'cell', id: 'a', lookId: 'rings', params: {} },
    b: { kind: 'cell', id: 'b', lookId: 'rings', params: {} },
  };
  expect(layoutCells(root, 100, 1000)).toEqual([
    { id: 'a', x: 0, y: 0, w: 100, h: 500 },
    { id: 'b', x: 0, y: 500, w: 100, h: 500 },
  ]);
});

test('missing params fall back to ParamDef defaults (rings: rows=0 auto, size=1)', () => {
  const r: Readings = { ...readings, drums: [{ time: 1, kind: 'kick', velocity: 1 }] };
  const opsWith = (params: Record<string, number>) => {
    const surfaces = new RecordingSurfaceProvider();
    const composition: Composition = {
      ...single,
      root: { kind: 'cell', id: 'c1', lookId: 'rings', params },
    };
    renderFrame({ composition, t: 1.5, readings: r, surfaces, target: { w: 540, h: 960 } });
    return surfaces.surfaces.get('c1')?.painter.ops;
  };
  const defaults = opsWith({});
  expect(defaults?.some((o) => o.op === 'circle')).toBe(true);
  expect(defaults).toEqual(opsWith({ rows: 0, size: 1 }));
  expect(defaults).not.toEqual(opsWith({ rows: 0, size: 1.5 }));
});

function frameTexts(surfaces: RecordingSurfaceProvider): string[] {
  return (surfaces.surfaces.get('c1:frame')?.painter.ops ?? [])
    .filter((o) => o.op === 'text')
    .map((o) => o.args[0] as string);
}

test('frame label is the padded number then the upper-cased id; the look itself gets no label', () => {
  const surfaces = new RecordingSurfaceProvider();
  renderFrame({ composition: single, t: 0, readings, surfaces, target: { w: 540, h: 960 } });
  expect(frameTexts(surfaces).slice(0, 2)).toEqual(['06', 'RINGS']);
  const lookTexts = surfaces.surfaces.get('c1')?.painter.ops.filter((o) => o.op === 'text') ?? [];
  expect(lookTexts.map((o) => o.args[0])).not.toContain('06 RINGS');
});

test('title is drawn only when the composition has one', () => {
  const surfaces = new RecordingSurfaceProvider();
  renderFrame({
    composition: { ...single, title: 'KILL LOVE' },
    t: 0,
    readings,
    surfaces,
    target: { w: 540, h: 960 },
  });
  expect(frameTexts(surfaces)[0]).toBe('KILL LOVE');
  const plain = new RecordingSurfaceProvider();
  renderFrame({ composition: single, t: 0, readings, surfaces: plain, target: { w: 540, h: 960 } });
  expect(frameTexts(plain)).not.toContain('KILL LOVE');
});

test('frame draws a readout row with labels and values', () => {
  const surfaces = new RecordingSurfaceProvider();
  renderFrame({ composition: single, t: 3, readings, surfaces, target: { w: 540, h: 960 } });
  const texts = frameTexts(surfaces);
  // rings 是 Sheet 系：PRINTED / PEN / TIME
  expect(texts).toContain('PRINTED');
  expect(texts).toContain('Rings');
});

test('canvas style: cells sit inside the safe area and the footer shows the time', () => {
  const surfaces = new RecordingSurfaceProvider();
  const composition: Composition = {
    ...single,
    canvas: { ...DEFAULT_CANVAS, signature: '@me' },
    root: {
      kind: 'split',
      id: 's1',
      direction: 'row',
      ratio: 0.5,
      a: { kind: 'cell', id: 'c1', lookId: 'rings', params: {} },
      b: { kind: 'cell', id: 'c2', lookId: 'rings', params: {} },
    },
  };
  renderFrame({ composition, t: 75, readings, surfaces, target: { w: 1080, h: 1920 } });
  const { box, gap } = contentBox(composition, 1080, 1920);
  expect(box).toEqual({ x: 54, y: 202, w: 972, h: 1392 });
  const half = (box.w - gap) / 2;
  expect([surfaces.surfaces.get('c1:frame')?.w, surfaces.surfaces.get('c2:frame')?.w]).toEqual([
    half,
    half,
  ]);
  const footer = surfaces.surfaces.get('canvas:footer');
  expect(footer?.h).toBe(1920 - 1594);
  const texts = footer?.painter.ops.filter((o) => o.op === 'text').map((o) => o.args[0]);
  expect(texts).toEqual(['1:15 / 1:00', '@me']);
});

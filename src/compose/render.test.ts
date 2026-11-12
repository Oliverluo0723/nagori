import { Midi } from '@tonejs/midi';
import { expect, test } from 'vitest';
import { makeMidi } from '../../test/fixtures/midi';
import { buildTempoMap } from '../analysis/tempo';
import type { Readings } from '../analysis/types';
import { layoutCells, renderFrame } from './render';
import { RecordingSurfaceProvider } from './surface';
import type { Composition, LayoutNode } from './types';

const tempo = buildTempoMap(new Midi(makeMidi({ bpm: 120, tracks: [] })).header);
const readings: Readings = { duration: 60, tempo, drums: [], roles: [] };
const single: Composition = {
  aspect: { w: 9, h: 16 },
  root: { kind: 'cell', id: 'c1', lookId: 'rings', params: {} },
  themeId: 'darkGlow',
};

test('single cell fills the target and draws with the right size', () => {
  const surfaces = new RecordingSurfaceProvider();
  renderFrame({ composition: single, t: 0, readings, surfaces, target: { w: 540, h: 960 } });
  const s = surfaces.surfaces.get('c1');
  expect(s).toBeDefined();
  expect([s?.w, s?.h]).toEqual([540, 960]);
  expect(s?.painter.ops[0]).toEqual({ op: 'background', args: ['#0f0f0f'] });
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

test('missing params fall back to ParamDef defaults (windowBars=2)', () => {
  // 120 bpm 一小節 2 秒，視窗 2 小節 = 4 秒，pxPerSec = 540/4 = 135
  // kick 在 1 秒，t = 1.5：x = 0.62*540 − 0.5*135 = 267.3
  const surfaces = new RecordingSurfaceProvider();
  const r: Readings = { ...readings, drums: [{ time: 1, kind: 'kick', velocity: 1 }] };
  renderFrame({ composition: single, t: 1.5, readings: r, surfaces, target: { w: 540, h: 960 } });
  const circle = surfaces.surfaces.get('c1')?.painter.ops.find((o) => o.op === 'circle');
  expect(circle?.args[0]).toBeCloseTo(267.3, 1);
});

test('label is padded look number plus upper-cased id', () => {
  const surfaces = new RecordingSurfaceProvider();
  renderFrame({ composition: single, t: 0, readings, surfaces, target: { w: 540, h: 960 } });
  const text = surfaces.surfaces.get('c1')?.painter.ops.find((o) => o.op === 'text');
  expect(text?.args[0]).toBe('06 RINGS');
});

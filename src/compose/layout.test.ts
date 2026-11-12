import { describe, expect, it, test } from 'vitest';
import { looks } from '../looks/registry';
import {
  cellsOf,
  findCell,
  layoutTree,
  PRESETS,
  ratioAt,
  removeCell,
  setCellLook,
  setCellVideo,
  setRatio,
  splitCell,
} from './layout';
import type { LayoutNode } from './types';

const one: LayoutNode = { kind: 'cell', id: 'c1', lookId: 'rings', params: {} };

describe('splitCell / removeCell', () => {
  it('splits a cell into two with fresh ids and the same look', () => {
    const { root, newCellId } = splitCell(one, 'c1', 'row');
    expect(newCellId).toBe('c2');
    expect(root).toMatchObject({ kind: 'split', id: 's1', direction: 'row', ratio: 0.5 });
    expect(cellsOf(root).map((c) => [c.id, c.lookId])).toEqual([
      ['c1', 'rings'],
      ['c2', 'rings'],
    ]);
  });

  it('ids keep counting after nested splits', () => {
    const a = splitCell(one, 'c1', 'row').root;
    const b = splitCell(a, 'c2', 'column');
    expect(b.newCellId).toBe('c3');
    expect(cellsOf(b.root).map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('removing a cell lets its sibling take the space', () => {
    const a = splitCell(one, 'c1', 'row').root;
    const b = splitCell(a, 'c2', 'column').root;
    const c = removeCell(b, 'c3');
    expect(c).toEqual(a);
    expect(removeCell(a, 'c1')).toMatchObject({ kind: 'cell', id: 'c2' });
  });

  it('the last cell cannot be removed', () => {
    expect(removeCell(one, 'c1')).toBe(one);
  });
});

describe('setRatio / setCellLook', () => {
  const two = splitCell(one, 'c1', 'column').root;

  it('clamps ratios so no cell collapses', () => {
    expect(setRatio(two, 's1', 0.02)).toMatchObject({ ratio: 0.1 });
    expect(setRatio(two, 's1', 0.7)).toMatchObject({ ratio: 0.7 });
  });

  it('changes one cell look and resets its params', () => {
    const r = setCellLook(two, 'c2', 'strata');
    expect(cellsOf(r).map((c) => c.lookId)).toEqual(['rings', 'strata']);
  });
});

describe('layoutTree', () => {
  it('subtracts the gap before splitting by ratio', () => {
    const root = setRatio(splitCell(one, 'c1', 'row').root, 's1', 0.25);
    const { cells, dividers } = layoutTree(root, { x: 10, y: 20, w: 410, h: 100 }, 10);
    expect(cells).toEqual([
      { id: 'c1', x: 10, y: 20, w: 100, h: 100 },
      { id: 'c2', x: 120, y: 20, w: 300, h: 100 },
    ]);
    expect(dividers[0]).toMatchObject({ splitId: 's1', at: 105 });
  });

  it('dragging a divider maps the pointer back to a ratio', () => {
    const root = splitCell(one, 'c1', 'column').root;
    const { dividers } = layoutTree(root, { x: 0, y: 100, w: 50, h: 410 }, 10);
    expect(ratioAt(dividers[0], { x: 0, y: 100 + 5 + 100 }, 10)).toBeCloseTo(0.25);
  });
});

describe('PRESETS', () => {
  it('only use looks that exist and have unique cell ids', () => {
    for (const p of PRESETS) {
      const cells = cellsOf(p.build());
      for (const c of cells) expect(looks[c.lookId], `${p.id}/${c.lookId}`).toBeDefined();
      expect(new Set(cells.map((c) => c.id)).size).toBe(cells.length);
    }
  });
});

test('setCellVideo adds and removes a video, keeping the look', () => {
  const one = PRESETS[0].build();
  const v = { clipId: 'v1', start: 2, alignX: 0.5, alignY: 0.5, mirror: false, lookOnTop: true };
  const withVideo = setCellVideo(one, 'c1', v);
  expect(findCell(withVideo, 'c1')?.video).toEqual(v);
  const back = setCellVideo(withVideo, 'c1', undefined);
  expect(back).toEqual(one);
});

import type { Cell, LayoutNode, Split, VideoLayer } from './types';

/**
 * 切格樹的編輯操作。全部是純函式：回傳新樹，不改舊樹。
 * id 的規則：格子 c1、c2…，切線 s1、s2…，取目前最大號 +1（同樣的操作順序得到同樣的 id）。
 */

export const MIN_RATIO = 0.1;
export const MAX_RATIO = 0.9;

function ids(root: LayoutNode, out: string[] = []): string[] {
  out.push(root.id);
  if (root.kind === 'split') {
    ids(root.a, out);
    ids(root.b, out);
  }
  return out;
}

function nextId(root: LayoutNode, prefix: 'c' | 's'): string {
  let max = 0;
  for (const id of ids(root)) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

export function cellsOf(root: LayoutNode): Cell[] {
  if (root.kind === 'cell') return [root];
  return [...cellsOf(root.a), ...cellsOf(root.b)];
}

export function findCell(root: LayoutNode, id: string): Cell | undefined {
  if (root.kind === 'cell') return root.id === id ? root : undefined;
  return findCell(root.a, id) ?? findCell(root.b, id);
}

function mapNode(root: LayoutNode, id: string, fn: (n: LayoutNode) => LayoutNode): LayoutNode {
  if (root.id === id) return fn(root);
  if (root.kind === 'cell') return root;
  const a = mapNode(root.a, id, fn);
  const b = mapNode(root.b, id, fn);
  return a === root.a && b === root.b ? root : { ...root, a, b };
}

/** 把一格切成兩格；新格接在右邊（row）或下面（column），先沿用同一個 look。 */
export function splitCell(
  root: LayoutNode,
  cellId: string,
  direction: Split['direction'],
): { root: LayoutNode; newCellId: string } {
  const newCellId = nextId(root, 'c');
  const splitId = nextId(root, 's');
  const next = mapNode(root, cellId, (n) => {
    if (n.kind !== 'cell') return n;
    const b: Cell = { kind: 'cell', id: newCellId, lookId: n.lookId, params: {} };
    return { kind: 'split', id: splitId, direction, ratio: 0.5, a: n, b };
  });
  return { root: next, newCellId };
}

/** 刪掉一格：它的鄰格（同一條切線的另一邊）長大補位。只剩一格時不動。 */
export function removeCell(root: LayoutNode, cellId: string): LayoutNode {
  if (root.kind === 'cell') return root;
  if (root.a.id === cellId) return root.b;
  if (root.b.id === cellId) return root.a;
  const a = removeCell(root.a, cellId);
  const b = removeCell(root.b, cellId);
  return a === root.a && b === root.b ? root : { ...root, a, b };
}

export function setRatio(root: LayoutNode, splitId: string, ratio: number): LayoutNode {
  const r = Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
  return mapNode(root, splitId, (n) => (n.kind === 'split' ? { ...n, ratio: r } : n));
}

export function setCellLook(root: LayoutNode, cellId: string, lookId: string): LayoutNode {
  return mapNode(root, cellId, (n) => (n.kind === 'cell' ? { ...n, lookId, params: {} } : n));
}

/** 放、改、拿掉一格的影片；look 留著，拿掉影片就回到原本的 look。 */
export function setCellVideo(
  root: LayoutNode,
  cellId: string,
  video: VideoLayer | undefined,
): LayoutNode {
  return mapNode(root, cellId, (n) => {
    if (n.kind !== 'cell') return n;
    const { video: _old, ...rest } = n;
    return video ? { ...rest, video } : rest;
  });
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CellBox extends Box {
  id: string;
}

/** 一條切線：box 是被切的那塊，at 是切線在 box 內的位置（px），拖動時用來換算比例。 */
export interface Divider {
  splitId: string;
  direction: Split['direction'];
  box: Box;
  at: number;
}

/**
 * 把樹攤平成格子與切線。gap 是格與格之間的空隙（px），從被切的那塊扣掉後再依比例分。
 */
export function layoutTree(
  root: LayoutNode,
  box: Box,
  gap = 0,
): { cells: CellBox[]; dividers: Divider[] } {
  const cells: CellBox[] = [];
  const dividers: Divider[] = [];
  const walk = (node: LayoutNode, b: Box) => {
    if (node.kind === 'cell') {
      cells.push({ id: node.id, ...b });
      return;
    }
    if (node.direction === 'row') {
      const aw = (b.w - gap) * node.ratio;
      dividers.push({ splitId: node.id, direction: 'row', box: b, at: aw + gap / 2 });
      walk(node.a, { x: b.x, y: b.y, w: aw, h: b.h });
      walk(node.b, { x: b.x + aw + gap, y: b.y, w: b.w - aw - gap, h: b.h });
    } else {
      const ah = (b.h - gap) * node.ratio;
      dividers.push({ splitId: node.id, direction: 'column', box: b, at: ah + gap / 2 });
      walk(node.a, { x: b.x, y: b.y, w: b.w, h: ah });
      walk(node.b, { x: b.x, y: b.y + ah + gap, w: b.w, h: b.h - ah - gap });
    }
  };
  walk(root, box);
  return { cells, dividers };
}

/** 拖切線：游標位置（同一個座標系）→ 新比例。 */
export function ratioAt(d: Divider, pointer: { x: number; y: number }, gap = 0): number {
  const span = (d.direction === 'row' ? d.box.w : d.box.h) - gap;
  const pos = d.direction === 'row' ? pointer.x - d.box.x : pointer.y - d.box.y;
  return (pos - gap / 2) / span;
}

const cell = (id: string, lookId: string): Cell => ({ kind: 'cell', id, lookId, params: {} });
const split = (
  id: string,
  direction: Split['direction'],
  ratio: number,
  a: LayoutNode,
  b: LayoutNode,
): Split => ({ kind: 'split', id, direction, ratio, a, b });

/** 內建版型：照參考 Reel 的切法起手，之後再自由切。 */
export const PRESETS: { id: string; name: string; build: () => LayoutNode }[] = [
  { id: 'one', name: '一格', build: () => cell('c1', 'rings') },
  {
    id: 'stack',
    name: '上下',
    build: () => split('s1', 'column', 0.5, cell('c1', 'rings'), cell('c2', 'strata')),
  },
  {
    id: 'quad',
    name: '四格',
    // 黑底發光那支：左一條長的，右邊上大下兩格
    build: () =>
      split(
        's1',
        'row',
        0.3,
        cell('c1', 'strata'),
        split(
          's2',
          'column',
          0.55,
          cell('c2', 'fountain'),
          split('s3', 'row', 0.5, cell('c3', 'blot'), cell('c4', 'polygraph')),
        ),
      ),
  },
  {
    id: 'side',
    name: '大＋三',
    // 雲那支：左邊一大格（放影片），右邊三格疊起來
    build: () =>
      split(
        's1',
        'row',
        0.58,
        cell('c1', 'flow'),
        split(
          's2',
          'column',
          0.42,
          cell('c2', 'comet'),
          split('s3', 'column', 0.5, cell('c3', 'rings'), cell('c4', 'kaleido')),
        ),
      ),
  },
];

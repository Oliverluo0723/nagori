import type { Readings } from '../analysis/types';
import { readoutsFor } from '../looks/readouts';
import { looks } from '../looks/registry';
import type { Look, LookContext } from '../looks/types';
import { drawFrame, frameLayout } from './frame';
import type { SurfaceProvider } from './surface';
import { themes } from './themes';
import type { Cell, Composition, LayoutNode } from './types';

export interface CellRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 把切格樹攤平成每格的矩形。Cell → 全幅；Split 依 direction 與 ratio 遞迴。 */
export function layoutCells(root: LayoutNode, w: number, h: number): CellRect[] {
  const out: CellRect[] = [];
  const walk = (node: LayoutNode, x: number, y: number, nw: number, nh: number) => {
    if (node.kind === 'cell') {
      out.push({ id: node.id, x, y, w: nw, h: nh });
      return;
    }
    if (node.direction === 'row') {
      const aw = nw * node.ratio;
      walk(node.a, x, y, aw, nh);
      walk(node.b, x + aw, y, nw - aw, nh);
    } else {
      const ah = nh * node.ratio;
      walk(node.a, x, y, nw, ah);
      walk(node.b, x, y + ah, nw, nh - ah);
    }
  };
  walk(root, 0, 0, w, h);
  return out;
}

function findCell(root: LayoutNode, id: string): Cell | undefined {
  if (root.kind === 'cell') return root.id === id ? root : undefined;
  return findCell(root.a, id) ?? findCell(root.b, id);
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function labelOf(look: Look): string {
  return `${String(look.number).padStart(2, '0')} ${look.id.toUpperCase()}`;
}

function paramsWithDefaults(look: Look, given: Record<string, number | boolean>) {
  const params: Record<string, number | boolean> = {};
  for (const def of look.params) params[def.key] = def.default;
  return { ...params, ...given };
}

export interface RenderFrameOptions {
  composition: Composition;
  t: number;
  readings: Readings;
  surfaces: SurfaceProvider;
  target: { w: number; h: number; ctx?: CanvasRenderingContext2D };
}

/** 給一個 t，畫出整張畫布的一幀。有 target.ctx 時把各格貼上去。 */
export function renderFrame(opts: RenderFrameOptions): void {
  const { composition, t, readings, surfaces, target } = opts;
  const theme = themes[composition.themeId];
  if (!theme) throw new Error(`unknown theme: ${composition.themeId}`);

  const withTitle = composition.root.kind === 'cell' && !!composition.title;
  for (const rect of layoutCells(composition.root, target.w, target.h)) {
    const cell = findCell(composition.root, rect.id);
    if (!cell) continue;
    const look = looks[cell.lookId];
    if (!look) throw new Error(`unknown look: ${cell.lookId}`);
    const layout = frameLayout(rect.w, rect.h, withTitle);
    const { plot } = layout;
    // look 只看得到繪圖框：它的 w/h 就是框的大小，標籤改由外框畫
    const surface = surfaces.get(cell.id, plot.w, plot.h);
    const ctx: LookContext = {
      t,
      w: plot.w,
      h: plot.h,
      readings,
      theme,
      params: paramsWithDefaults(look, cell.params),
      seed: hashString(cell.id),
    };
    look.draw(surface.painter, ctx);
    const frame = surfaces.get(`${cell.id}:frame`, rect.w, rect.h);
    drawFrame(frame.painter, {
      w: rect.w,
      h: rect.h,
      theme,
      layout,
      title: withTitle ? composition.title : undefined,
      number: look.number,
      name: look.id,
      readouts: readoutsFor(look, ctx),
    });
    if (target.ctx && frame.image && surface.image) {
      target.ctx.drawImage(frame.image, rect.x, rect.y, rect.w, rect.h);
      target.ctx.drawImage(surface.image, rect.x + plot.x, rect.y + plot.y, plot.w, plot.h);
    }
  }
}

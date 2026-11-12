import type { Readings } from '../analysis/types';
import type { Painter } from '../looks/painter/painter';
import { readoutsFor } from '../looks/readouts';
import { looks } from '../looks/registry';
import type { Look, LookContext } from '../looks/types';
import { drawFooter } from './footer';
import { drawFrame, frameLayout } from './frame';
import { type Box, findCell, layoutTree } from './layout';
import type { SurfaceProvider } from './surface';
import { themes } from './themes';
import type { CanvasStyle, Composition, LayoutNode, VideoLayer } from './types';
import { coverCrop, type VideoFrame, type VideoProvider } from './video';

export interface CellRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 把切格樹攤平成每格的矩形。Cell → 全幅；Split 依 direction 與 ratio 遞迴。 */
export function layoutCells(root: LayoutNode, w: number, h: number, gap = 0): CellRect[] {
  return layoutTree(root, { x: 0, y: 0, w, h }, gap).cells;
}

export const DEFAULT_CANVAS: CanvasStyle = {
  padX: 0.05,
  padTop: 0.105,
  padBottom: 0.17,
  gap: 0.03,
  footer: true,
  signature: 'oto',
};

/** 格子區與格距（px）。沒有 canvas 設定就是整張、零間距。 */
export function contentBox(
  composition: Composition,
  w: number,
  h: number,
): { box: Box; gap: number } {
  const c = composition.canvas;
  if (!c) return { box: { x: 0, y: 0, w, h }, gap: 0 };
  const x = Math.round(c.padX * w);
  const y = Math.round(c.padTop * h);
  return {
    box: { x, y, w: w - 2 * x, h: Math.round(h * (1 - c.padBottom)) - y },
    gap: Math.round(c.gap * w),
  };
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
  /** 有影片格才需要；沒給的話影片格只畫底色。 */
  videos?: VideoProvider;
}

/** 疊在影片上的 look 與外框：background() 改成清成透明，其他照舊。 */
const clearBgCache = new WeakMap<Painter, Painter>();
function clearBackground(p: Painter): Painter {
  let wrapped = clearBgCache.get(p);
  if (!wrapped) {
    const bound = new Map<PropertyKey, unknown>();
    wrapped = new Proxy(p, {
      get(target, key) {
        if (key === 'background') return () => target.clear();
        let fn = bound.get(key);
        if (fn === undefined) {
          const v = Reflect.get(target, key, target);
          fn = typeof v === 'function' ? v.bind(target) : v;
          bound.set(key, fn);
        }
        return fn;
      },
    });
    clearBgCache.set(p, wrapped);
  }
  return wrapped;
}

/** 影片疊 look 時壓一層底色，讓線條在亮的畫面上也讀得到。 */
const SCRIM_ALPHA = 0.35;

function drawVideo(
  ctx: CanvasRenderingContext2D,
  frame: VideoFrame,
  rect: CellRect,
  layer: VideoLayer,
): void {
  const crop = coverCrop(frame, rect, layer.alignX, layer.alignY, layer.mirror);
  ctx.save();
  if (layer.mirror) {
    ctx.translate(rect.x + rect.w, rect.y);
    ctx.scale(-1, 1);
    ctx.drawImage(frame.image, crop.x, crop.y, crop.w, crop.h, 0, 0, rect.w, rect.h);
  } else {
    ctx.drawImage(frame.image, crop.x, crop.y, crop.w, crop.h, rect.x, rect.y, rect.w, rect.h);
  }
  ctx.restore();
}

/** 給一個 t，畫出整張畫布的一幀。有 target.ctx 時把各格貼上去。 */
export function renderFrame(opts: RenderFrameOptions): void {
  const { composition, t, readings, surfaces, target, videos } = opts;
  const theme = themes[composition.themeId];
  if (!theme) throw new Error(`unknown theme: ${composition.themeId}`);

  const withTitle = composition.root.kind === 'cell' && !!composition.title;
  const { box, gap } = contentBox(composition, target.w, target.h);
  if (target.ctx && composition.canvas) {
    target.ctx.fillStyle = theme.paper;
    target.ctx.fillRect(0, 0, target.w, target.h);
  }
  for (const rect of layoutTree(composition.root, box, gap).cells) {
    const cell = findCell(composition.root, rect.id);
    if (!cell) continue;
    const video = cell.video;
    if (video && target.ctx) {
      // 影片填滿整格（cover），不留報表外框的邊
      target.ctx.fillStyle = theme.paper;
      target.ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      const frame = videos?.frame(cell.id);
      if (frame && frame.w > 0 && frame.h > 0) drawVideo(target.ctx, frame, rect, video);
      if (video.lookOnTop) {
        target.ctx.globalAlpha = SCRIM_ALPHA;
        target.ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        target.ctx.globalAlpha = 1;
      }
    }
    if (video && !video.lookOnTop) continue;
    const look = looks[cell.lookId];
    if (!look) throw new Error(`unknown look: ${cell.lookId}`);
    const layout = frameLayout(rect.w, rect.h, withTitle);
    const { plot } = layout;
    // look 只看得到繪圖框：它的 w/h 就是框的大小，標籤改由外框畫
    const surface = surfaces.get(cell.id, plot.w, plot.h);
    const lookPainter = video ? clearBackground(surface.painter) : surface.painter;
    const ctx: LookContext = {
      t,
      w: plot.w,
      h: plot.h,
      readings,
      theme,
      params: paramsWithDefaults(look, cell.params),
      seed: hashString(cell.id),
    };
    look.draw(lookPainter, ctx);
    const frame = surfaces.get(`${cell.id}:frame`, rect.w, rect.h);
    drawFrame(video ? clearBackground(frame.painter) : frame.painter, {
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

  const canvas = composition.canvas;
  if (canvas?.footer) {
    const top = box.y + box.h;
    const strip = surfaces.get('canvas:footer', target.w, target.h - top);
    drawFooter(strip.painter, {
      w: target.w,
      h: target.h - top,
      canvasW: target.w,
      padX: box.x,
      theme,
      t,
      duration: readings.duration,
      signature: canvas.signature,
    });
    if (target.ctx && strip.image) {
      target.ctx.drawImage(strip.image, 0, top, target.w, target.h - top);
    }
  }
}

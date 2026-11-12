import type { Box } from './layout';
import type { VideoLayer } from './types';

/** 一格影片在某一刻要畫的圖：預覽是 <video>，輸出是解好的幀。 */
export interface VideoFrame {
  image: CanvasImageSource;
  w: number;
  h: number;
}

/** 依 cellId 給目前這一刻的影片幀；還沒載好就回 null（那格先只畫底色）。 */
export interface VideoProvider {
  frame(cellId: string): VideoFrame | null;
}

/** 最後一幀前留一點，免得落在最後一幀結束之後拿不到畫面。 */
const END_GUARD = 0.001;

/** 歌的時間 → 影片的時間。開頭之前停第一幀，結尾之後停最後一幀。 */
export function clipTime(t: number, layer: Pick<VideoLayer, 'start'>, duration: number): number {
  const vt = t - layer.start;
  if (!(duration > 0)) return Math.max(0, vt);
  return Math.min(Math.max(0, vt), Math.max(0, duration - END_GUARD));
}

/** 這一刻影片是不是正在走（不是停在頭尾）。預覽據此決定要不要讓 <video> 播。 */
export function clipRunning(
  t: number,
  layer: Pick<VideoLayer, 'start'>,
  duration: number,
): boolean {
  const vt = t - layer.start;
  return vt >= 0 && vt < duration - END_GUARD;
}

/**
 * cover 裁切：來源要切哪一塊才能填滿目標、不變形。
 * align 0 = 貼齊左／上，1 = 貼齊右／下（以畫面上看到的方向；鏡像時 x 反過來取）。
 */
export function coverCrop(
  src: { w: number; h: number },
  dst: { w: number; h: number },
  alignX: number,
  alignY: number,
  mirror = false,
): Box {
  const scale = Math.max(dst.w / src.w, dst.h / src.h);
  const w = dst.w / scale;
  const h = dst.h / scale;
  const ax = mirror ? 1 - alignX : alignX;
  return { x: (src.w - w) * clamp01(ax), y: (src.h - h) * clamp01(alignY), w, h };
}

/** 拖動對齊：畫面上拖了 dx、dy（目標座標 px），回傳新的 align。 */
export function dragAlign(
  src: { w: number; h: number },
  dst: { w: number; h: number },
  align: { x: number; y: number },
  dx: number,
  dy: number,
): { x: number; y: number } {
  const scale = Math.max(dst.w / src.w, dst.h / src.h);
  const overX = src.w * scale - dst.w;
  const overY = src.h * scale - dst.h;
  // 往右拖 = 圖往右移 = 露出左邊 = 對齊點往 0 走
  return {
    x: overX > 0.5 ? clamp01(align.x - dx / overX) : align.x,
    y: overY > 0.5 ? clamp01(align.y - dy / overY) : align.y,
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function newVideoLayer(clipId: string): VideoLayer {
  return { clipId, start: 0, alignX: 0.5, alignY: 0.5, mirror: false, lookOnTop: false };
}

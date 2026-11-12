import type { Painter } from '../looks/painter/painter';
import { RecordingPainter } from '../looks/painter/recording';

/** 一格的畫布：look 透過 painter 畫，合成時拿 image 貼到主畫布。 */
export interface Surface {
  painter: Painter;
  image: CanvasImageSource | null;
  resize(w: number, h: number): void;
}

export interface SurfaceProvider {
  get(cellId: string, w: number, h: number): Surface;
}

/** 測試用：每格一個 RecordingPainter，沒有真的畫布。 */
export class RecordingSurfaceProvider implements SurfaceProvider {
  readonly surfaces = new Map<string, { painter: RecordingPainter; w: number; h: number }>();

  get(cellId: string, w: number, h: number): Surface {
    let entry = this.surfaces.get(cellId);
    if (!entry || entry.w !== w || entry.h !== h) {
      entry = { painter: new RecordingPainter(), w, h };
      this.surfaces.set(cellId, entry);
    } else {
      entry.painter.ops.length = 0;
    }
    const e = entry;
    return {
      painter: e.painter,
      image: null,
      resize(nw, nh) {
        e.w = nw;
        e.h = nh;
      },
    };
  }
}

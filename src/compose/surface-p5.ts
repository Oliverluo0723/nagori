import type p5 from 'p5';
import { P5Painter } from '../looks/painter/p5';
import type { Surface, SurfaceProvider } from './surface';

interface Entry {
  graphics: p5.Graphics;
  painter: P5Painter;
  w: number;
  h: number;
}

/** 每個 cellId 一個 p5.Graphics；尺寸變了才重建。 */
export class P5SurfaceProvider implements SurfaceProvider {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly p: p5,
    private readonly glowEnabled: () => boolean,
  ) {}

  get(cellId: string, w: number, h: number): Surface {
    const iw = Math.max(1, Math.round(w));
    const ih = Math.max(1, Math.round(h));
    let entry = this.entries.get(cellId);
    if (!entry || entry.w !== iw || entry.h !== ih) {
      entry?.graphics.remove();
      const graphics = this.p.createGraphics(iw, ih);
      entry = { graphics, painter: new P5Painter(graphics, this.glowEnabled()), w: iw, h: ih };
      this.entries.set(cellId, entry);
    }
    const e = entry;
    return {
      painter: e.painter,
      image: e.graphics.elt as HTMLCanvasElement,
      resize: (nw, nh) => {
        this.get(cellId, nw, nh);
      },
    };
  }

  destroy(): void {
    for (const e of this.entries.values()) e.graphics.remove();
    this.entries.clear();
  }
}

import type { Painter } from '../looks/painter/painter';
import type { Theme } from './types';

/**
 * 畫布底部資訊列（參考 Reel 量的，以畫布寬為 1）：
 * 左邊一條進度線（0.05→0.41），接著 "0:12 / 2:08"，右邊簽名 + 強調色圓點。
 */
export interface FooterContent {
  /** 這條帶子的大小 */
  w: number;
  h: number;
  /** 整張畫布的寬，尺寸都以它縮放 */
  canvasW: number;
  padX: number;
  theme: Theme;
  t: number;
  duration: number;
  signature: string;
}

function clock(s: number): string {
  const v = Math.max(0, Math.floor(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

export function drawFooter(p: Painter, c: FooterContent): void {
  const { theme, canvasW: W, padX } = c;
  p.background(theme.paper);
  const y = 0.046 * W;
  const x0 = padX;
  const x1 = 0.41 * W;
  const frac = c.duration > 0 ? Math.min(1, Math.max(0, c.t / c.duration)) : 0;

  p.stroke(theme.mute, Math.max(1, 0.002 * W), 0.6);
  p.line(x0, y, x1, y);
  p.stroke(theme.ink, Math.max(1, 0.004 * W));
  if (frac > 0) p.line(x0, y, x0 + (x1 - x0) * frac, y);
  p.noStroke();

  const timeSize = 0.021 * W;
  p.fill(theme.mute);
  p.text(`${clock(c.t)} / ${clock(c.duration)}`, 0.43 * W, y - timeSize * 0.62, {
    size: timeSize,
    font: 'mono',
    tracking: 0.04,
  });

  if (c.signature) {
    const size = 0.034 * W;
    const dot = size * 0.32;
    const right = c.w - padX;
    p.fill(theme.accent);
    p.circle(right - dot / 2, y + size * 0.12, dot);
    p.fill(theme.ink);
    p.text(c.signature, right - dot * 1.4, y - size * 0.6, {
      size,
      font: 'sans',
      weight: 700,
      align: 'right',
      tracking: -0.03,
    });
  }
}

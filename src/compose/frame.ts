import type { Painter } from '../looks/painter/painter';
import type { Readout } from '../looks/types';
import type { Theme } from './types';

/**
 * Oto 式的報表外框：左上大標（只有單格且有歌名時）、編號 + 名稱、
 * 中間一個固定邊距的繪圖框（look 只畫在裡面）、左下讀數列。
 * 尺寸以 1080 px 寬的 Oto 海報量出來，依格子短邊等比縮放。
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameLayout {
  /** 1080 基準下的 1 px */
  unit: number;
  margin: number;
  titleY: number | null;
  labelY: number;
  readoutY: number;
  plot: Rect;
}

const REF = 1080;
/** JetBrains Mono 每個字固定 0.6 em 寬 */
const MONO_ADVANCE = 0.6;

const TITLE = { size: 64, tracking: -0.045 };
const LABEL = { size: 17, tracking: 0.08 };
const READ_LABEL = { size: 13, tracking: 0.1 };
const READ_VALUE = { size: 24, gap: 27 };

export function frameLayout(w: number, h: number, withTitle: boolean): FrameLayout {
  const u = Math.min(w, h) / REF;
  const margin = Math.round(48 * u);
  const titleY = withTitle ? 40 * u : null;
  const labelY = withTitle ? 128 * u : 40 * u;
  const top = Math.round(labelY + (LABEL.size + 30) * u);
  const readoutY = h - 86 * u;
  const bottom = Math.round(h - 128 * u);
  return {
    unit: u,
    margin,
    titleY,
    labelY,
    readoutY,
    plot: { x: margin, y: top, w: Math.max(1, w - 2 * margin), h: Math.max(1, bottom - top) },
  };
}

function monoWidth(chars: number, size: number, tracking: number): number {
  return chars * (MONO_ADVANCE + tracking) * size;
}

export interface FrameContent {
  w: number;
  h: number;
  theme: Theme;
  layout: FrameLayout;
  title?: string;
  number: number;
  name: string;
  readouts: Readout[];
}

export function drawFrame(p: Painter, c: FrameContent): void {
  const { theme, layout: L } = c;
  const u = L.unit;
  p.background(theme.paper);
  p.noStroke();

  if (c.title && L.titleY !== null) {
    p.fill(theme.ink);
    p.text(c.title, L.margin, L.titleY, {
      size: TITLE.size * u,
      font: 'sans',
      weight: 700,
      tracking: TITLE.tracking,
    });
  }

  const num = String(c.number).padStart(2, '0');
  const labelStyle = {
    size: LABEL.size * u,
    font: 'mono' as const,
    weight: 700 as const,
    tracking: LABEL.tracking,
  };
  p.fill(theme.accent);
  p.text(num, L.margin, L.labelY, labelStyle);
  p.fill(theme.ink);
  p.text(
    c.name.toUpperCase(),
    L.margin + monoWidth(num.length + 1, labelStyle.size, LABEL.tracking),
    L.labelY,
    labelStyle,
  );

  let x = L.margin;
  for (const r of c.readouts) {
    const label = r.label.toUpperCase();
    const colW =
      Math.max(
        monoWidth(label.length, READ_LABEL.size * u, READ_LABEL.tracking),
        monoWidth(r.value.length, READ_VALUE.size * u, 0),
      ) +
      44 * u;
    if (x + colW - 44 * u > c.w - L.margin) break;
    p.fill(theme.mute);
    p.text(label, x, L.readoutY, {
      size: READ_LABEL.size * u,
      font: 'mono',
      tracking: READ_LABEL.tracking,
    });
    p.fill(theme.ink);
    p.text(r.value, x, L.readoutY + READ_VALUE.gap * u, {
      size: READ_VALUE.size * u,
      font: 'mono',
    });
    x += colW;
  }
}

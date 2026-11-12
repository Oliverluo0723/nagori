import type { Painter } from '../looks/painter/painter';
import type { Readout } from '../looks/types';
import type { Theme } from './types';

/**
 * Oto 式的報表外框：左上大標（只有單格且有歌名時）、編號 + 名稱、
 * 中間一個固定邊距的繪圖框（look 只畫在裡面）、左下讀數列。
 * 尺寸以 1080 px 寬的 Oto 海報量出來，依格子短邊等比縮放；
 * 但字級有下限：畫布切成小格時字不會縮到看不見（1080×1920 整張縮成 ~400 px 寬預覽時仍讀得出來）。
 * 讀數欄放不下就從後面丟；格子太矮就整列讀數不畫，繪圖框往下長。
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 外框實際用的字級（px）。 */
export interface FrameText {
  title: number;
  label: number;
  readLabel: number;
  readValue: number;
  /** 讀數值的 y 相對於讀數標籤的位移 */
  valueOffset: number;
  /** 讀數欄之間的間距 */
  colGap: number;
}

export interface FrameLayout {
  /** 1080 基準下的 1 px */
  unit: number;
  margin: number;
  titleY: number | null;
  labelY: number;
  /** 讀數列標籤的 y；格子太矮不畫讀數時為 null */
  readoutY: number | null;
  plot: Rect;
  text: FrameText;
}

const REF = 1080;
/** JetBrains Mono 每個字固定 0.6 em 寬 */
const MONO_ADVANCE = 0.6;

const TITLE = { size: 64, min: 40, tracking: -0.045 };
const LABEL = { size: 17, min: 22, tracking: 0.08 };
const READ_LABEL = { size: 13, min: 16, tracking: 0.1 };
const READ_VALUE = { size: 24, min: 26 };
/** 繪圖框至少要佔格子高度這麼多，不然讀數列讓位 */
const MIN_PLOT_SHARE = 0.5;

/**
 * pxPerRef：畫布上 1 px 等於 1080 寬輸出的幾 px（輸出 1080 寬 = 1；540 寬預覽 = 0.5）。
 * 字級下限以 1080 寬輸出的 px 計，乘上它換成這張畫布的 px。
 */
export function frameLayout(w: number, h: number, withTitle: boolean, pxPerRef = 1): FrameLayout {
  const u = Math.min(w, h) / REF;
  const s = pxPerRef;
  const text: FrameText = {
    title: Math.max(TITLE.size * u, TITLE.min * s),
    label: Math.max(LABEL.size * u, LABEL.min * s),
    readLabel: Math.max(READ_LABEL.size * u, READ_LABEL.min * s),
    readValue: Math.max(READ_VALUE.size * u, READ_VALUE.min * s),
    valueOffset: 0,
    colGap: Math.max(44 * u, 22 * s),
  };
  text.valueOffset = text.readLabel + 0.6 * text.readValue;

  const margin = Math.round(Math.max(48 * u, 16 * s));
  const pad = Math.max(40 * u, 12 * s);
  const titleY = withTitle ? pad : null;
  const labelY = titleY !== null ? titleY + text.title + Math.max(24 * u, 10 * s) : pad;
  const top = Math.round(labelY + text.label + Math.max(30 * u, 12 * s));

  const bottomPad = Math.max(36 * u, 12 * s);
  const plotGap = Math.max(42 * u, 14 * s);
  const readoutY = h - bottomPad - text.readValue - text.valueOffset;
  const withReadouts = Math.round(readoutY - plotGap) - top >= h * MIN_PLOT_SHARE;
  const bottom = Math.round(withReadouts ? readoutY - plotGap : h - bottomPad);
  return {
    unit: u,
    margin,
    titleY,
    labelY,
    readoutY: withReadouts ? readoutY : null,
    plot: { x: margin, y: top, w: Math.max(1, w - 2 * margin), h: Math.max(1, bottom - top) },
    text,
  };
}

function monoWidth(chars: number, size: number, tracking: number): number {
  return chars * (MONO_ADVANCE + tracking) * size;
}

export interface PlacedReadout {
  label: string;
  value: string;
  x: number;
}

/** 讀數欄從左排到右，放不下的（含之後的）全部丟掉；讀數列隱藏時回空陣列。 */
export function placeReadouts(readouts: Readout[], L: FrameLayout, w: number): PlacedReadout[] {
  if (L.readoutY === null) return [];
  const out: PlacedReadout[] = [];
  let x = L.margin;
  for (const r of readouts) {
    const label = r.label.toUpperCase();
    const span = Math.max(
      monoWidth(label.length, L.text.readLabel, READ_LABEL.tracking),
      monoWidth(r.value.length, L.text.readValue, 0),
    );
    if (x + span > w - L.margin) break;
    out.push({ label, value: r.value, x });
    x += span + L.text.colGap;
  }
  return out;
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
  p.background(theme.paper);
  p.noStroke();

  if (c.title && L.titleY !== null) {
    p.fill(theme.ink);
    p.text(c.title, L.margin, L.titleY, {
      size: L.text.title,
      font: 'sans',
      weight: 700,
      tracking: TITLE.tracking,
    });
  }

  const num = String(c.number).padStart(2, '0');
  const labelStyle = {
    size: L.text.label,
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

  if (L.readoutY === null) return;
  for (const r of placeReadouts(c.readouts, L, c.w)) {
    p.fill(theme.mute);
    p.text(r.label, r.x, L.readoutY, {
      size: L.text.readLabel,
      font: 'mono',
      tracking: READ_LABEL.tracking,
    });
    p.fill(theme.ink);
    p.text(r.value, r.x, L.readoutY + L.text.valueOffset, {
      size: L.text.readValue,
      font: 'mono',
    });
  }
}

/** 主題：look 只用這些語意顏色，不寫死色碼。整張畫布一次套一個主題。 */
export interface Theme {
  id: string;
  name: string;
  paper: string;
  ink: string;
  mute: string;
  line: string;
  accent: string;
  /** 12 色，依 C、C♯、D … B 順序。 */
  noteColors: string[];
  glow: boolean;
}

export interface Cell {
  kind: 'cell';
  id: string;
  lookId: string;
  params: Record<string, number | boolean>;
}

export interface Split {
  kind: 'split';
  id: string;
  direction: 'row' | 'column';
  /** a 佔的比例，0..1。 */
  ratio: number;
  a: LayoutNode;
  b: LayoutNode;
}

/** 畫布的切格樹。 */
export type LayoutNode = Cell | Split;

/**
 * 整張畫布的版面（參考 Reel 量的）：四周安全區、格距、底部資訊列。
 * padX、gap 以畫布寬為 1；padTop、padBottom 以畫布高為 1。
 */
export interface CanvasStyle {
  padX: number;
  padTop: number;
  padBottom: number;
  gap: number;
  /** 底部資訊列：進度線、時間、簽名 */
  footer: boolean;
  signature: string;
}

export interface Composition {
  aspect: { w: number; h: number };
  /** 沒給就整張滿版、沒有底欄（舊行為） */
  canvas?: CanvasStyle;
  /** 歌名；單格時畫成左上大標。 */
  title?: string;
  root: LayoutNode;
  themeId: string;
}

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

/** 畫布的切格樹。本里程碑只會出現 Cell。 */
export type LayoutNode = Cell | Split;

export interface Composition {
  aspect: { w: number; h: number };
  /** 歌名；單格時畫成左上大標。 */
  title?: string;
  root: LayoutNode;
  themeId: string;
}

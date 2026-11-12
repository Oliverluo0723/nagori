export interface TextStyle {
  size: number;
  font: 'sans' | 'mono';
  align?: 'left' | 'center' | 'right';
  weight?: 400 | 700;
  /** 字距，以字級為單位（-0.04 = 收緊 4%）。預設 0。 */
  tracking?: number;
}

/**
 * look 畫圖用的最小介面。look 只透過它畫圖，不直接碰 p5 或 canvas。
 * 顏色是主題給的字串；alpha 0..1，預設 1。
 */
export interface Painter {
  background(color: string): void;
  /** 清成全透明（疊在影片上的 look 用來去背）。 */
  clear(): void;
  fill(color: string, alpha?: number): void;
  noFill(): void;
  stroke(color: string, weight: number, alpha?: number): void;
  noStroke(): void;
  /**
   * blur 單位 px；主題 glow=false 時實作可以忽略。
   * 代價很高：canvas 的 shadowBlur 每個圖形都要在 GPU 上模糊一次，幾百個就會掉到 15 fps。
   * 一幀最多用在幾十個圖形上；大量粒子請用 sheet.ts 的 softDot（光暈圓 + 核心圓）。
   */
  glow(color: string, blur: number): void;
  noGlow(): void;
  circle(x: number, y: number, d: number): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  text(s: string, x: number, y: number, style: TextStyle): void;
  /** 環形扇面（rInner 可為 0），角度為弧度，0 在 3 點鐘方向、順時針增加。用目前的 fill/stroke。 */
  wedge(
    cx: number,
    cy: number,
    rInner: number,
    rOuter: number,
    startRad: number,
    endRad: number,
  ): void;
  /** 只 stroke 的折線。 */
  polyline(points: { x: number; y: number }[]): void;
  ellipse(cx: number, cy: number, w: number, h: number): void;
  /** 用目前的 fill/stroke 畫一個封閉多邊形（點夠密就是平滑的有機形狀）。 */
  shape(points: { x: number; y: number }[]): void;
  /**
   * 徑向色暈：中心 color@alpha，到半徑 r 淡成全透明。不用 shadowBlur，很便宜，
   * 拿來鋪背景色光（Oto 的 Blot 粉霧、Dew 彩霧、Fountain 光柱）。不受目前 fill/stroke 影響。
   */
  haze(x: number, y: number, r: number, color: string, alpha: number): void;
  /** 之後的圖形怎麼跟底下疊：normal 一般、add 光相加（發光）、multiply 墨色相乘（紙感）。 */
  blend(mode: 'normal' | 'add' | 'multiply'): void;
}

export interface Point {
  x: number;
  y: number;
}

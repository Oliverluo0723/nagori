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
}

export interface Point {
  x: number;
  y: number;
}

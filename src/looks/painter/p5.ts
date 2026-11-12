import type p5 from 'p5';
import type { Painter, Point, TextStyle } from './painter';

const FONTS = {
  sans: 'Inter, system-ui, sans-serif',
  mono: 'JetBrains Mono, ui-monospace, Menlo, monospace',
} as const;

/** 把 Painter 的呼叫對應到一個 p5.Graphics。p5 只在這個檔案出現。 */
export class P5Painter implements Painter {
  constructor(
    private readonly g: p5.Graphics,
    private readonly glowEnabled: boolean,
  ) {}

  private get ctx2d(): CanvasRenderingContext2D {
    return this.g.drawingContext as CanvasRenderingContext2D;
  }

  private withAlpha(color: string, alpha: number | undefined): p5.Color {
    const c = this.g.color(color);
    if (alpha !== undefined) c.setAlpha(Math.round(Math.max(0, Math.min(1, alpha)) * 255));
    return c;
  }

  background(color: string): void {
    this.g.background(color);
  }
  fill(color: string, alpha?: number): void {
    this.g.fill(this.withAlpha(color, alpha));
  }
  noFill(): void {
    this.g.noFill();
  }
  stroke(color: string, weight: number, alpha?: number): void {
    this.g.stroke(this.withAlpha(color, alpha));
    this.g.strokeWeight(weight);
  }
  noStroke(): void {
    this.g.noStroke();
  }
  glow(color: string, blur: number): void {
    if (!this.glowEnabled) return;
    this.ctx2d.shadowColor = color;
    this.ctx2d.shadowBlur = blur;
  }
  noGlow(): void {
    this.ctx2d.shadowBlur = 0;
  }
  circle(x: number, y: number, d: number): void {
    this.g.circle(x, y, d);
  }
  line(x1: number, y1: number, x2: number, y2: number): void {
    this.g.line(x1, y1, x2, y2);
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.g.rect(x, y, w, h);
  }
  text(s: string, x: number, y: number, style: TextStyle): void {
    this.g.textFont(FONTS[style.font]);
    this.g.textSize(style.size);
    // p5 2.x 的 Graphics 物件上沒有 RIGHT/TOP 這些常數屬性，直接用常數的字串值
    this.g.textStyle(style.weight === 700 ? 'bold' : 'normal');
    this.g.textAlign(style.align ?? 'left', 'top');
    this.g.text(s, x, y);
  }
  wedge(
    cx: number,
    cy: number,
    rInner: number,
    rOuter: number,
    startRad: number,
    endRad: number,
  ): void {
    const g = this.g;
    const steps = 24;
    g.beginShape();
    for (let i = 0; i <= steps; i++) {
      const a = startRad + ((endRad - startRad) * i) / steps;
      g.vertex(cx + Math.cos(a) * rOuter, cy + Math.sin(a) * rOuter);
    }
    for (let i = steps; i >= 0; i--) {
      const a = startRad + ((endRad - startRad) * i) / steps;
      g.vertex(cx + Math.cos(a) * rInner, cy + Math.sin(a) * rInner);
    }
    g.endShape('close');
  }
  polyline(points: Point[]): void {
    const g = this.g;
    g.push();
    g.noFill();
    g.beginShape();
    for (const p of points) g.vertex(p.x, p.y);
    g.endShape();
    g.pop();
  }
  ellipse(cx: number, cy: number, w: number, h: number): void {
    this.g.ellipse(cx, cy, w, h);
  }
}

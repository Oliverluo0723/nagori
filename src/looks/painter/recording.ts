import type { Painter, Point, TextStyle } from './painter';

export type PaintOp = { op: keyof Painter; args: unknown[] };

/** 測試用：把每個繪圖呼叫依序記成 ops，不畫任何東西。 */
export class RecordingPainter implements Painter {
  readonly ops: PaintOp[] = [];

  private record(op: keyof Painter, ...args: unknown[]): void {
    this.ops.push({ op, args });
  }

  background(color: string): void {
    this.record('background', color);
  }
  fill(color: string, alpha?: number): void {
    this.record('fill', color, alpha);
  }
  noFill(): void {
    this.record('noFill');
  }
  stroke(color: string, weight: number, alpha?: number): void {
    this.record('stroke', color, weight, alpha);
  }
  noStroke(): void {
    this.record('noStroke');
  }
  glow(color: string, blur: number): void {
    this.record('glow', color, blur);
  }
  noGlow(): void {
    this.record('noGlow');
  }
  circle(x: number, y: number, d: number): void {
    this.record('circle', x, y, d);
  }
  line(x1: number, y1: number, x2: number, y2: number): void {
    this.record('line', x1, y1, x2, y2);
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.record('rect', x, y, w, h);
  }
  text(s: string, x: number, y: number, style: TextStyle): void {
    this.record('text', s, x, y, style);
  }
  wedge(
    cx: number,
    cy: number,
    rInner: number,
    rOuter: number,
    startRad: number,
    endRad: number,
  ): void {
    this.record('wedge', cx, cy, rInner, rOuter, startRad, endRad);
  }
  polyline(points: Point[]): void {
    this.record('polyline', points);
  }
  ellipse(cx: number, cy: number, w: number, h: number): void {
    this.record('ellipse', cx, cy, w, h);
  }
}

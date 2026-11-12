import type p5 from 'p5';
import type { Painter, Point, TextStyle } from './painter';

const FONTS = {
  sans: 'Inter, system-ui, sans-serif',
  mono: 'JetBrains Mono, ui-monospace, Menlo, monospace',
} as const;

/** '#rgb' / '#rrggbb' → 'rgba(r,g,b,a)'；不是 hex 就原樣回傳（alpha 交給 globalAlpha）。 */
export function rgba(color: string, alpha: number): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  const n = Number.parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const BLEND = { normal: 'source-over', add: 'lighter', multiply: 'multiply' } as const;

/** 把 Painter 的呼叫對應到一個 p5.Graphics。p5 只在這個檔案出現。 */
export class P5Painter implements Painter {
  constructor(
    private readonly g: p5.Graphics,
    private readonly glowEnabled: boolean,
  ) {}

  private get ctx2d(): CanvasRenderingContext2D {
    return this.g.drawingContext as CanvasRenderingContext2D;
  }

  /** p5 每次 color() 都要重新解析字串；同樣的顏色與 alpha 只解析一次。 */
  private readonly colors = new Map<string, p5.Color>();

  private withAlpha(color: string, alpha: number | undefined): p5.Color {
    const a = alpha === undefined ? 1 : Math.max(0, Math.min(1, alpha));
    const key = `${color}|${a.toFixed(3)}`;
    const hit = this.colors.get(key);
    if (hit) return hit;
    const c = this.g.color(color);
    if (alpha !== undefined) c.setAlpha(Math.round(a * 255));
    this.colors.set(key, c);
    return c;
  }

  background(color: string): void {
    // 每幀從 background/clear 開始：順便把上一幀留下的疊加模式歸位
    this.ctx2d.globalCompositeOperation = 'source-over';
    this.g.background(color);
  }
  clear(): void {
    this.ctx2d.globalCompositeOperation = 'source-over';
    this.g.clear();
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
    // 每次都設，避免上一段文字的字距殘留
    this.g.textProperty('letterSpacing', `${(style.tracking ?? 0) * style.size}px`);
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
  shape(points: Point[]): void {
    const g = this.g;
    g.beginShape();
    for (const p of points) g.vertex(p.x, p.y);
    g.endShape('close');
  }
  haze(x: number, y: number, r: number, color: string, alpha: number): void {
    if (!(r > 0) || alpha <= 0) return;
    const c = this.ctx2d;
    const inner = rgba(color, alpha);
    const outer = rgba(color, 0);
    c.save();
    c.shadowBlur = 0;
    if (inner && outer) {
      const grad = c.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, inner);
      grad.addColorStop(1, outer);
      c.fillStyle = grad;
    } else {
      c.globalAlpha *= alpha;
      c.fillStyle = color;
    }
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  blend(mode: 'normal' | 'add' | 'multiply'): void {
    this.ctx2d.globalCompositeOperation = BLEND[mode];
  }
}

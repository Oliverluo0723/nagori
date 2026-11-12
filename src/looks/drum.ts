import { positionAt, timeOfBar } from '../analysis/tempo';
import type { DrumHit } from '../analysis/types';
import type { Painter } from './painter/painter';
import { drawLabel, formatTime, paramNum, printedBeat } from './sheet';
import type { Look, LookContext, ParamDef } from './types';

const params: ParamDef[] = [
  { key: 'barsPerRow', label: '一列小節數', min: 2, max: 16, default: 8 },
  { key: 'gain', label: '振幅', min: 0.3, max: 2, default: 1 },
];

const LEFT = 0.1;
const WIDTH = 0.84;
const TOP = 0.12;
const BOTTOM = 0.88;
/** 每個鼓件的震盪：波長、衰減長度（都是列高的倍數）、振幅（列高的倍數）。 */
const VOICE: Record<DrumHit['kind'], { wave: number; decay: number; amp: number }> = {
  kick: { wave: 0.22, decay: 0.7, amp: 0.42 },
  snare: { wave: 0.1, decay: 0.45, amp: 0.3 },
  hat: { wave: 0.05, decay: 0.15, amp: 0.1 },
};
const REACH = 4; // 衰減長度的幾倍之後就不算

interface Pt {
  x: number;
  y: number;
}

function draw(p: Painter, ctx: LookContext): void {
  const { w, h, t, theme } = ctx;
  const { tempo, drums, duration } = ctx.readings;
  const barsPerRow = Math.max(1, Math.round(paramNum(ctx, params, 'barsPerRow')));
  const gain = paramNum(ctx, params, 'gain');
  const endPos = positionAt(tempo, Math.max(0, duration));
  const totalBars = Math.max(1, endPos.barPhase > 0 ? endPos.bar : endPos.bar - 1);
  const rows = Math.max(1, Math.ceil(totalBars / barsPerRow));
  const left = w * LEFT;
  const span = w * WIDTH;
  const rowGap = (h * (BOTTOM - TOP)) / rows;
  const rowY = (r: number) => h * TOP + (r + 0.5) * rowGap;
  const samples = Math.max(16, Math.round(span / 2));
  const beat = printedBeat(tempo, t);

  p.background(theme.paper);

  // 每列基線
  p.noFill();
  p.stroke(theme.line, h * 0.0008);
  for (let r = 0; r < rows; r++) p.line(left, rowY(r), left + span, rowY(r));

  for (let r = 0; r < rows; r++) {
    const firstBar = r * barsPerRow + 1;
    const start = timeOfBar(tempo, firstBar);
    const end = timeOfBar(tempo, firstBar + barsPerRow);
    if (!(end > start) || start > t) break;
    const xOf = (time: number) => left + ((time - start) / (end - start)) * span;
    const pxPerSec = span / (end - start);
    const reachSec = (REACH * VOICE.kick.decay * rowGap) / pxPerSec;
    const rowHits = drums.filter((d) => d.time >= start - reachSec && d.time <= Math.min(end, t));

    const ink: Pt[] = [];
    const accent: Pt[] = [];
    const printedTo = Math.min(t, end);
    let first = 0;
    for (let i = 0; i <= samples; i++) {
      const time = start + ((end - start) * i) / samples;
      if (time > printedTo) break;
      const x = xOf(time);
      let y = rowY(r);
      // 只有 x 之前、且還在衰減範圍內的 hit 會出力；hits 已依時間排序
      for (let k = first; k < rowHits.length; k++) {
        const hit = rowHits[k];
        const dx = x - xOf(hit.time);
        if (dx < 0) break;
        const v = VOICE[hit.kind];
        const decay = v.decay * rowGap;
        if (dx > REACH * decay) {
          if (k === first) first++;
          continue;
        }
        const env = Math.exp(-dx / decay) * (1 - Math.exp(-dx / (decay * 0.05)));
        y -=
          v.amp *
          rowGap *
          gain *
          hit.velocity *
          env *
          Math.sin((2 * Math.PI * dx) / (v.wave * rowGap));
      }
      const pt = { x, y };
      if (time < t - beat) ink.push(pt);
      else {
        if (accent.length === 0 && ink.length > 0) accent.push(ink[ink.length - 1]);
        accent.push(pt);
      }
    }
    p.noFill();
    if (ink.length > 1) {
      p.stroke(theme.ink, h * 0.0009);
      p.polyline(ink);
    }
    if (accent.length > 1) {
      if (theme.glow) p.glow(theme.accent, h * 0.005);
      p.stroke(theme.accent, h * 0.0009);
      p.polyline(accent);
      if (theme.glow) p.noGlow();
    }

    p.noStroke();
    p.fill(theme.mute);
    p.text(formatTime(start), left - w * 0.02, rowY(r), {
      size: h * 0.01,
      font: 'mono',
      align: 'right',
    });
  }

  drawLabel(p, ctx);
}

/** 地震鼓紋：一列 N 小節，每個 hit 是一段衰減震盪，kick 粗、snare 中、hat 細。 */
export const drumLook: Look = {
  id: 'drum',
  number: 8,
  name: '地震鼓紋',
  listens: ['drums', 'tempo'],
  params,
  draw,
};

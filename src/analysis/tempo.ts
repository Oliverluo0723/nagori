import type { Header } from '@tonejs/midi';
import type { BarPosition, TempoMap } from './types';

/** 把 @tonejs/midi 的 Header 抄成純資料。 */
export function buildTempoMap(header: Header): TempoMap {
  const tempos = header.tempos.map((t) => ({ ticks: t.ticks, bpm: t.bpm }));
  if (tempos.length === 0) tempos.push({ ticks: 0, bpm: 120 });
  tempos.sort((a, b) => a.ticks - b.ticks);
  const timeSignatures = header.timeSignatures
    .map((ts) => ({
      ticks: ts.ticks,
      numerator: ts.timeSignature[0] ?? 4,
      denominator: ts.timeSignature[1] ?? 4,
    }))
    .sort((a, b) => a.ticks - b.ticks);
  return { ppq: header.ppq, tempos, timeSignatures };
}

function secondsPerTick(bpm: number, ppq: number): number {
  return 60 / bpm / ppq;
}

/** 第一個 tempo 事件不在 tick 0 時，前面那段沿用它的 bpm（跟 @tonejs/midi 算 note.time 的方式一致）。 */
function temposFromZero(map: TempoMap): TempoMap['tempos'] {
  const first = map.tempos[0];
  if (!first) return [{ ticks: 0, bpm: 120 }];
  if (first.ticks > 0) return [{ ticks: 0, bpm: first.bpm }, ...map.tempos];
  return map.tempos;
}

/** 固定 bpm 的 tempo map；offset 是第一拍在音檔的秒數。 */
export function tempoMapFromBpm(bpm: number, offset = 0, ppq = 480): TempoMap {
  return { ppq, tempos: [{ ticks: 0, bpm }], timeSignatures: [], offset };
}

/** 秒 → ticks，依 tempos 分段積分。offset 之前的時間算成負 ticks。 */
export function secondsToTicks(map: TempoMap, seconds: number): number {
  const tempos = temposFromZero(map);
  const rel = seconds - (map.offset ?? 0);
  if (rel < 0) return rel / secondsPerTick(tempos[0].bpm, map.ppq);
  let ticks = 0;
  let elapsed = 0;
  seconds = rel;
  for (let i = 0; i < tempos.length; i++) {
    const cur = tempos[i];
    const next = tempos[i + 1];
    const spt = secondsPerTick(cur.bpm, map.ppq);
    const segmentTicks = next ? next.ticks - cur.ticks : Number.POSITIVE_INFINITY;
    const segmentSeconds = segmentTicks * spt;
    if (seconds - elapsed < segmentSeconds) {
      return ticks + (seconds - elapsed) / spt;
    }
    ticks += segmentTicks;
    elapsed += segmentSeconds;
  }
  return ticks;
}

/** ticks → 秒，依 tempos 分段積分，最後加上 offset。 */
export function ticksToSeconds(map: TempoMap, ticks: number): number {
  return ticksToSecondsRel(map, ticks) + (map.offset ?? 0);
}

function ticksToSecondsRel(map: TempoMap, ticks: number): number {
  const tempos = temposFromZero(map);
  if (ticks < 0) return ticks * secondsPerTick(tempos[0].bpm, map.ppq);
  let seconds = 0;
  for (let i = 0; i < tempos.length; i++) {
    const cur = tempos[i];
    const next = tempos[i + 1];
    const spt = secondsPerTick(cur.bpm, map.ppq);
    const end = next ? Math.min(next.ticks, ticks) : ticks;
    if (ticks <= cur.ticks) break;
    seconds += (end - cur.ticks) * spt;
    if (!next || ticks <= next.ticks) break;
  }
  return seconds;
}

export function bpmAt(map: TempoMap, t: number): number {
  const ticks = secondsToTicks(map, t);
  const tempos = temposFromZero(map);
  let bpm = tempos[0].bpm;
  for (const tempo of tempos) {
    if (tempo.ticks <= ticks) bpm = tempo.bpm;
    else break;
  }
  return bpm;
}

interface SignatureSegment {
  startTicks: number;
  startBar: number; // 1-based
  ticksPerBeat: number;
  beatsPerBar: number;
}

function signatureSegments(map: TempoMap): SignatureSegment[] {
  const sigs = map.timeSignatures.length
    ? map.timeSignatures
    : [{ ticks: 0, numerator: 4, denominator: 4 }];
  const segments: SignatureSegment[] = [];
  let bar = 1;
  for (let i = 0; i < sigs.length; i++) {
    const sig = sigs[i];
    const ticksPerBeat = map.ppq * (4 / sig.denominator);
    const seg = { startTicks: sig.ticks, startBar: bar, ticksPerBeat, beatsPerBar: sig.numerator };
    segments.push(seg);
    const next = sigs[i + 1];
    if (next) bar += Math.floor((next.ticks - sig.ticks) / (ticksPerBeat * sig.numerator));
  }
  return segments;
}

export function positionAt(map: TempoMap, t: number): BarPosition {
  const ticks = secondsToTicks(map, t);
  const segments = signatureSegments(map);
  let seg = segments[0];
  for (const s of segments) if (s.startTicks <= ticks) seg = s;
  const ticksPerBar = seg.ticksPerBeat * seg.beatsPerBar;
  const barsIn = (ticks - seg.startTicks) / ticksPerBar;
  const barIndex = Math.floor(barsIn);
  const barPhase = barsIn - barIndex;
  const beatsIn = barPhase * seg.beatsPerBar;
  const beatIndex = Math.floor(beatsIn);
  return {
    bar: seg.startBar + barIndex,
    beat: beatIndex + 1,
    barPhase,
    beatPhase: beatsIn - beatIndex,
    bpm: bpmAt(map, t),
  };
}

export function timeOfBar(map: TempoMap, bar: number): number {
  const segments = signatureSegments(map);
  let seg = segments[0];
  for (const s of segments) if (s.startBar <= bar) seg = s;
  const ticks = seg.startTicks + (bar - seg.startBar) * seg.ticksPerBeat * seg.beatsPerBar;
  return ticksToSeconds(map, ticks);
}

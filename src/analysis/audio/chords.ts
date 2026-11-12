import { pcFromName, pcName } from '../../looks/music';
import type { ChordEvent, KeyInfo } from '../types';
import { getEssentia } from './essentia';

const SR = 44100;
const FRAME = 4096;
const HOP = 2048;
const MAJOR = [0, 4, 7];
const MINOR = [0, 3, 7];

export interface RawChord {
  name: string;
  start: number;
  end: number;
}

/** essentia 的和弦名（'F#m'、'Bb'、'D'、'N'）→ 根音、三和弦 pitch class、顯示名。 */
export function chordFromName(
  name: string,
): { root: number; notes: number[]; display: string } | null {
  if (!name || name === 'N') return null;
  const m = /^([A-G][#b]?)(m?)$/.exec(name);
  if (!m) return null;
  const root = pcFromName(m[1]);
  if (root < 0) return null;
  const minor = m[2] === 'm';
  const notes = (minor ? MINOR : MAJOR).map((i) => (root + i) % 12);
  const display = `${m[1].replace('#', '♯').replace('b', '♭')}${minor ? 'm' : ''}`;
  return { root, notes, display };
}

function snapToBeat(t: number, beats: number[]): number {
  if (beats.length === 0) return t;
  let best = beats[0];
  for (const b of beats) if (Math.abs(b - t) < Math.abs(best - t)) best = b;
  return best;
}

function beatLength(beats: number[]): number {
  if (beats.length < 2) return 0.5;
  return (beats[beats.length - 1] - beats[0]) / (beats.length - 1);
}

/**
 * 平滑：邊界吸到最近的拍；短於半拍的事件併入前一個（或下一個）；相同名稱的連續事件合併。
 * 純函式，不用 essentia。
 */
export function smoothChords(raw: RawChord[], beats: number[]): ChordEvent[] {
  const half = beatLength(beats) / 2;
  // 1. 丟掉 'N' 與短碎片：把它們的時間併入前一段（沒有前一段就併入下一段）
  const kept: RawChord[] = [];
  for (const r of raw) {
    const isBlip = r.end - r.start < half || chordFromName(r.name) === null;
    if (isBlip && kept.length > 0) {
      kept[kept.length - 1].end = r.end;
      continue;
    }
    if (isBlip) continue;
    kept.push({ ...r });
  }
  // 2. 相同名稱合併
  const merged: RawChord[] = [];
  for (const r of kept) {
    const last = merged[merged.length - 1];
    if (last && last.name === r.name) last.end = r.end;
    else merged.push({ ...r });
  }
  // 3. 邊界吸到拍
  const events: ChordEvent[] = [];
  for (const r of merged) {
    const prev = events[events.length - 1];
    const start = prev ? prev.time + prev.duration : snapToBeat(r.start, beats);
    const end = snapToBeat(r.end, beats);
    const info = chordFromName(r.name);
    if (!info || end <= start) continue;
    events.push({
      time: start,
      duration: end - start,
      root: info.root,
      name: info.display,
      notes: info.notes,
    });
  }
  return events;
}

/** HPCP 逐幀 → essentia ChordsDetection → 平滑；調性用 KeyExtractor。pcm 必須是 44.1 kHz。 */
export async function detectChords(
  pcm: Float32Array,
  beats: number[],
): Promise<{ chords: ChordEvent[]; key?: KeyInfo }> {
  if (pcm.length < FRAME * 2) return { chords: [] };
  let peak = 0;
  for (let i = 0; i < pcm.length; i += 64) peak = Math.max(peak, Math.abs(pcm[i]));
  if (peak < 1e-4) return { chords: [] };

  const ess = await getEssentia();
  const frames = ess.FrameGenerator(pcm, FRAME, HOP);
  const hpcps = new ess.module.VectorVectorFloat();
  const n = frames.size();
  for (let i = 0; i < n; i++) {
    const win = ess.Windowing(frames.get(i), true, FRAME, 'blackmanharris62');
    const spec = ess.Spectrum(win.frame, FRAME);
    const peaks = ess.SpectralPeaks(spec.spectrum, 0, 5000, 60, 20, 'frequency', SR);
    const hpcp = ess.HPCP(
      peaks.frequencies,
      peaks.magnitudes,
      true,
      500,
      0,
      5000,
      false,
      40,
      false,
      'unitMax',
      440,
      SR,
      12,
      'squaredCosine',
      1,
    );
    hpcps.push_back(hpcp.hpcp);
  }
  // windowSize 0.5 s：2 s 會把和弦邊界抹掉半秒；碎片交給 smoothChords
  const detected = ess.ChordsDetection(hpcps, HOP, SR, 0.5);
  const raw: RawChord[] = [];
  const count = detected.chords.size();
  for (let i = 0; i < count; i++) {
    const name = detected.chords.get(i);
    const t = (i * HOP) / SR;
    const last = raw[raw.length - 1];
    if (last && last.name === name) last.end = t + HOP / SR;
    else raw.push({ name, start: t, end: t + HOP / SR });
  }
  const chords = smoothChords(raw, beats);

  const k = ess.KeyExtractor(ess.arrayToVector(pcm));
  const tonic = pcFromName(k.key);
  const key: KeyInfo | undefined =
    tonic >= 0 && k.strength > 0
      ? {
          tonic,
          mode: k.scale === 'minor' ? 'minor' : 'major',
          name: `${pcName(tonic)} ${k.scale === 'minor' ? 'minor' : 'major'}`,
        }
      : undefined;
  return { chords, key };
}

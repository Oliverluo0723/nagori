import { binHz, binValue, frameAt } from '../analysis/audio/spectrum';
import { positionAt } from '../analysis/tempo';
import type { Spectrum } from '../analysis/types';
import { midiName } from './glide';
import { bassAt, formatTime } from './sheet';
import type { Look, LookContext, Readout } from './types';

/** Sheet 系：整首印成一張，讀數照 Oto 的 PRINTED / PEN / TIME。 */
const SHEETS = new Set(['ridge', 'drum', 'disc', 'polygraph', 'corona', 'gel', 'string', 'mesh']);
const MAX = 4;

function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`;
}

function peakHz(s: Spectrum, t: number): number {
  const f = frameAt(s, t);
  let best = 0;
  for (let b = 1; b < s.bins; b++) if (binValue(s, f, b) > binValue(s, f, best)) best = b;
  return binHz(s, best);
}

function capitalize(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** 面板左下的讀數列：look 有自訂就用，否則依它聽的讀數組，最多四欄。 */
export function readoutsFor(look: Look, ctx: LookContext): Readout[] {
  if (look.readouts) return look.readouts(ctx).slice(0, MAX);
  const { t, readings: r } = ctx;
  if (SHEETS.has(look.id)) {
    const printed = r.duration > 0 ? Math.min(1, Math.max(0, t / r.duration)) : 0;
    return [
      { label: 'PRINTED', value: `${Math.round(printed * 100)} %` },
      { label: 'PEN', value: capitalize(look.id) },
      { label: 'TIME', value: formatTime(t) },
    ];
  }
  const out: Readout[] = [];
  for (const kind of look.listens) {
    if (kind === 'drums') {
      let hits = 0;
      for (const d of r.drums) if (d.time <= t) hits++;
      out.push({ label: 'HITS', value: String(hits) });
    } else if (kind === 'bass') {
      const b = bassAt(r.bass ?? [], t, true);
      out.push({ label: 'BASS', value: b ? midiName(b.midi) : '—' });
    } else if (kind === 'chords') {
      const c = r.chords?.find((e) => e.time <= t && t < e.time + e.duration);
      out.push({ label: 'CHORD', value: c?.name ?? '—' });
    } else if (kind === 'key' && r.key) {
      out.push({ label: 'KEY', value: r.key.name });
    } else if (kind === 'spectrum' && r.spectrum) {
      out.push({ label: 'PEAK', value: formatHz(peakHz(r.spectrum, t)) });
    }
  }
  const pos = positionAt(r.tempo, t);
  out.push({ label: 'BAR', value: `${pos.bar}.${pos.beat}` });
  out.push({ label: 'TEMPO', value: `${Math.round(pos.bpm)} BPM` });
  out.push({ label: 'TIME', value: formatTime(t) });
  return out.slice(0, MAX);
}

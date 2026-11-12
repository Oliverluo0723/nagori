import { useCallback, useState } from 'react';
import { analyzeMidi, withSpectrum } from '../analysis/analyze';
import { analyzeAudio, type Progress, type Stage } from '../analysis/analyzeAudio';
import { decodeAudio } from '../analysis/audio/decode';
import { analyzeSpectrum } from '../analysis/audio/spectrum';
import { mergeReadings } from '../analysis/merge';
import { tempoMapFromBpm } from '../analysis/tempo';
import type { Readings } from '../analysis/types';

const AUDIO_EXT = ['mp3', 'wav', 'aiff', 'aif', 'flac', 'm4a', 'ogg'];
const MIDI_EXT = ['mid', 'midi'];

export type LoadFailure = 'need-audio' | 'parse-failed' | 'no-beat';
export type LoadResult =
  | { ok: true; readings: Readings; audioUrl: string; name: string }
  | { ok: false; reason: LoadFailure };

export interface LoadDeps {
  getDuration: (audio: File) => Promise<number>;
  createUrl?: (audio: File) => string;
  /** 有給就解碼音檔；Node 測試注入合成的 pcm。 */
  decode?: (audio: File) => Promise<{ pcm: Float32Array; sampleRate: number }>;
  /** 純音訊分析（沒有 .mid 或 .mid 缺角色軌時用）；預設 analyzeAudio */
  analyze?: (pcm: Float32Array, sampleRate: number, onProgress: Progress) => Promise<Readings>;
  onProgress?: Progress;
}

function ext(file: File): string {
  const i = file.name.lastIndexOf('.');
  return i < 0 ? '' : file.name.slice(i + 1).toLowerCase();
}

function basename(file: File): string {
  return file.name.replace(/\.[^.]+$/, '').toLowerCase();
}

/** 同名的 .mid 優先；只有一個 .mid 時直接配；多個卻沒有同名的就不猜。 */
function pickMidi(audio: File, midis: File[]): File | undefined {
  const same = midis.find((m) => basename(m) === basename(audio));
  if (same) return same;
  return midis.length === 1 ? midis[0] : undefined;
}

/** 拖進來的檔案分流：找音檔與 .mid，分析後回傳 Readings。 */
export async function loadDroppedFiles(files: File[], deps: LoadDeps): Promise<LoadResult> {
  const audio = files.find((f) => AUDIO_EXT.includes(ext(f)));
  if (!audio) return { ok: false, reason: 'need-audio' };
  const midi = pickMidi(
    audio,
    files.filter((f) => MIDI_EXT.includes(ext(f))),
  );
  const progress = deps.onProgress ?? (() => {});
  try {
    const duration = await deps.getDuration(audio);
    let midiReadings: Readings | undefined;
    if (midi) midiReadings = analyzeMidi(await midi.arrayBuffer(), duration);

    let audioReadings: Readings | undefined;
    if (deps.decode) {
      // 音檔解不開：有 MIDI 就照常用 MIDI，沒有就失敗
      try {
        progress('decode', 0);
        const { pcm, sampleRate } = await deps.decode(audio);
        const needsAudio =
          !midiReadings ||
          midiReadings.drums.length === 0 ||
          (midiReadings.chords?.length ?? 0) === 0 ||
          (midiReadings.bass?.length ?? 0) === 0;
        if (needsAudio || !midiReadings) {
          const analyze = deps.analyze ?? analyzeAudio;
          audioReadings = await analyze(pcm, sampleRate, progress);
        } else {
          audioReadings = withSpectrum(
            { ...midiReadings, drums: [], chords: [], bass: [], key: undefined, source: undefined },
            analyzeSpectrum(pcm, sampleRate),
          );
        }
      } catch (err) {
        if (!midiReadings) throw err;
        console.warn('audio decode failed; continuing with MIDI only', err);
      }
    }
    if (!midiReadings && !audioReadings) return { ok: false, reason: 'parse-failed' };
    if (!midiReadings && audioReadings?.source?.tempo === 'none')
      return { ok: false, reason: 'no-beat' };
    const readings = mergeReadings(midiReadings, audioReadings);
    const createUrl = deps.createUrl ?? ((f: File) => URL.createObjectURL(f));
    return {
      ok: true,
      readings,
      audioUrl: createUrl(audio),
      name: audio.name.replace(/\.[^.]+$/, ''),
    };
  } catch (err) {
    console.error('load failed', err);
    return { ok: false, reason: 'parse-failed' };
  }
}

/** 用 <audio> 的 loadedmetadata 讀長度。 */
export function audioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = new Audio();
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(el.duration);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('cannot read audio'));
    };
    el.src = url;
  });
}

/** 換 tempo map（BPM 候選或第一拍微調），其他欄位不動。 */
export function applyTempo(readings: Readings, bpm: number, offset: number): Readings {
  return { ...readings, tempo: tempoMapFromBpm(bpm, offset) };
}

export type ProjectState =
  | { status: 'empty' }
  | { status: 'analyzing'; stage: Stage; fraction: number }
  | { status: 'error'; reason: LoadFailure }
  | { status: 'ready'; readings: Readings; audioUrl: string; name: string };

export function useProject() {
  const [state, setState] = useState<ProjectState>({ status: 'empty' });

  const drop = useCallback(async (files: File[]) => {
    setState({ status: 'analyzing', stage: 'decode', fraction: 0 });
    const r = await loadDroppedFiles(files, {
      getDuration: audioDuration,
      decode: decodeAudio,
      onProgress: (stage, fraction) => setState({ status: 'analyzing', stage, fraction }),
    });
    if (r.ok)
      setState({ status: 'ready', readings: r.readings, audioUrl: r.audioUrl, name: r.name });
    else setState({ status: 'error', reason: r.reason });
  }, []);

  const setTempo = useCallback((bpm: number, offset: number) => {
    setState((s) =>
      s.status === 'ready' ? { ...s, readings: applyTempo(s.readings, bpm, offset) } : s,
    );
  }, []);

  return { state, drop, setTempo };
}

import { useCallback, useRef, useState } from 'react';
import { analyzeMidi, withSpectrum } from '../analysis/analyze';
import type { Progress, Stage } from '../analysis/analyzeAudio';
import { decodeAudio } from '../analysis/audio/decode';
import { analyzeSpectrum } from '../analysis/audio/spectrum';
import { mergeReadings } from '../analysis/merge';
import { OpfsStemStore, type StemStore, stemKey } from '../analysis/stems/cache';
import { MODEL_MISSING } from '../analysis/stems/separate';
import { tempoMapFromBeats, tempoMapFromBpm } from '../analysis/tempo';
import type { Readings } from '../analysis/types';
import { type AnalyzeFn, analyzeInline, analyzeInWorker } from '../analysis/workerClient';

const AUDIO_EXT = ['mp3', 'wav', 'aiff', 'aif', 'flac', 'm4a', 'ogg'];
const MIDI_EXT = ['mid', 'midi'];

export type LoadFailure = 'need-audio' | 'parse-failed' | 'no-beat' | 'aborted';
export type LoadResult =
  | { ok: true; readings: Readings; audioUrl: string; name: string; notes: string[] }
  | { ok: false; reason: LoadFailure };

const NOTE_NO_MODEL = '找不到分軌模型，改用混音分析：先跑 pnpm setup:models';
const noteFor = (separationError: string | undefined) =>
  !separationError || separationError.startsWith(MODEL_MISSING)
    ? NOTE_NO_MODEL
    : `分軌失敗，改用混音分析：${separationError}`;

const isAbort = (err: unknown) => err instanceof Error && err.name === 'AbortError';

export interface LoadDeps {
  getDuration: (audio: File) => Promise<number>;
  createUrl?: (audio: File) => string;
  /** 有給就解碼音檔；Node 測試注入合成的 pcm（left/right 可省，省了就拿 pcm 當左右）。 */
  decode?: (audio: File) => Promise<{
    pcm: Float32Array;
    sampleRate: number;
    left?: Float32Array;
    right?: Float32Array;
  }>;
  /** 純音訊分析（沒有 .mid 或 .mid 缺角色軌時用）；預設在 Worker 裡跑 */
  analyze?: AnalyzeFn;
  /** 分軌快取；預設 OPFS，Node 測試給 MemoryStemStore */
  stemStore?: StemStore;
  /** 要不要分軌（預設要） */
  separate?: boolean;
  /** 取消（使用者又丟了另一首）：結果是 { ok: false, reason: 'aborted' } */
  signal?: AbortSignal;
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
  const notes: string[] = [];
  try {
    const duration = await deps.getDuration(audio);
    let midiReadings: Readings | undefined;
    if (midi) midiReadings = analyzeMidi(await midi.arrayBuffer(), duration);

    let audioReadings: Readings | undefined;
    if (deps.decode) {
      // 音檔解不開：有 MIDI 就照常用 MIDI，沒有就失敗
      try {
        progress('decode', 0);
        const { pcm, sampleRate, left, right } = await deps.decode(audio);
        const needsAudio =
          !midiReadings ||
          midiReadings.drums.length === 0 ||
          (midiReadings.chords?.length ?? 0) === 0 ||
          (midiReadings.bass?.length ?? 0) === 0;
        if (needsAudio || !midiReadings) {
          // 沒有 Worker 的環境（Node 測試）就在這條執行緒跑
          const analyze =
            deps.analyze ?? (typeof Worker === 'undefined' ? analyzeInline : analyzeInWorker);
          const store = deps.stemStore ?? new OpfsStemStore();
          const key = await stemKey(await audio.arrayBuffer());
          const cached = await store.get(key);
          const separate = deps.separate !== false && !cached;
          let gotStems = false;
          let separationError: string | undefined;
          audioReadings = await analyze(
            {
              pcm,
              sampleRate,
              left: left ?? pcm,
              right: right ?? pcm,
              stems: cached,
              separate,
            },
            progress,
            (stems) => {
              gotStems = true;
              store.put(key, stems).catch((err) => console.warn('stem cache write failed', err));
            },
            (message) => {
              separationError = message;
            },
            deps.signal,
          );
          // 要分軌卻沒拿到 stems：模型不在或 ORT 載不起來，分析已退回混音
          if (separate && !gotStems) notes.push(noteFor(separationError));
        } else {
          audioReadings = withSpectrum(
            { ...midiReadings, drums: [], chords: [], bass: [], key: undefined, source: undefined },
            analyzeSpectrum(pcm, sampleRate),
          );
        }
      } catch (err) {
        if (isAbort(err) || !midiReadings) throw err;
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
      notes,
    };
  } catch (err) {
    if (isAbort(err)) return { ok: false, reason: 'aborted' };
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

/**
 * 換 tempo map（BPM 候選或第一拍微調），其他欄位不動。
 * bpm 還是偵測到的那個時保留跟著拍點走的 map，只把整條拍點平移到新的第一拍；
 * 選了別的候選（×2、÷2…）才退回固定 bpm。
 */
export function applyTempo(readings: Readings, bpm: number, offset: number): Readings {
  const r = readings.rhythm;
  const current = readings.tempo.offset ?? 0;
  const downbeat = r ? r.beats.findIndex((b) => Math.abs(b - current) < 1e-6) : -1;
  if (r && downbeat >= 0 && Math.abs(bpm - r.bpm) < 0.05) {
    const shift = offset - current;
    return {
      ...readings,
      tempo: tempoMapFromBeats(
        r.beats.map((b) => b + shift),
        { downbeat },
      ),
    };
  }
  return { ...readings, tempo: tempoMapFromBpm(bpm, offset) };
}

export type ProjectState =
  | { status: 'empty' }
  | { status: 'analyzing'; stage: Stage; fraction: number }
  | { status: 'error'; reason: LoadFailure }
  | { status: 'ready'; readings: Readings; audioUrl: string; name: string; notes: string[] };

export function useProject() {
  const [state, setState] = useState<ProjectState>({ status: 'empty' });

  // 分析中又丟了另一首：取消前一次（Worker terminate），而且舊的那次什麼都不准再寫進 state
  const current = useRef<AbortController | null>(null);

  const drop = useCallback(async (files: File[]) => {
    current.current?.abort();
    const ctrl = new AbortController();
    current.current = ctrl;
    const live = () => !ctrl.signal.aborted;
    setState({ status: 'analyzing', stage: 'decode', fraction: 0 });
    const r = await loadDroppedFiles(files, {
      getDuration: audioDuration,
      decode: decodeAudio,
      signal: ctrl.signal,
      onProgress: (stage, fraction) => {
        if (live()) setState({ status: 'analyzing', stage, fraction });
      },
    });
    if (!live()) return;
    if (r.ok)
      setState({
        status: 'ready',
        readings: r.readings,
        audioUrl: r.audioUrl,
        name: r.name,
        notes: r.notes,
      });
    else setState({ status: 'error', reason: r.reason });
  }, []);

  const setTempo = useCallback((bpm: number, offset: number) => {
    setState((s) =>
      s.status === 'ready' ? { ...s, readings: applyTempo(s.readings, bpm, offset) } : s,
    );
  }, []);

  return { state, drop, setTempo };
}

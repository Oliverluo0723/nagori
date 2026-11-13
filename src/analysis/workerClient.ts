import { analyzeAudio, buildTempo, type Progress } from './analyzeAudio';
import { chordsFromNotes } from './audio/chords';
import { type NoteStore, noteKey, OpfsNoteStore, opfsAvailable } from './audio/noteCache';
import { NOTE_THRESHOLDS, thresholdsKey } from './audio/notes';
import { NOTES_MODEL_MISSING, type TranscribeFn, transcribeNotes } from './audio/transcribe';
import { type SeparateOptions, separateStems } from './stems/separate';
import { mixStems, type Stems } from './stems/types';
import type { NoteEvent, Readings } from './types';

export interface AnalyzeInput {
  /** 單聲道混音 */
  pcm: Float32Array;
  sampleRate: number;
  /** 給分軌用的左右聲道（單聲道來源就兩條同一個） */
  left: Float32Array;
  right: Float32Array;
  /** 快取裡已有的分軌（有就不再分） */
  stems?: Stems;
  /** 沒有 stems 時要不要跑 Demucs */
  separate: boolean;
}

export type AnalyzeFn = (
  input: AnalyzeInput,
  onProgress: Progress,
  onStems?: (stems: Stems) => void,
  /** 要分軌卻分不成時的原因（模型不在、ORT 載不起來…） */
  onSeparationError?: (message: string) => void,
  /** 取消：Worker 版會 terminate，之後 reject AbortError */
  signal?: AbortSignal,
) => Promise<Readings>;

export type SeparateFn = (
  left: Float32Array,
  right: Float32Array,
  opts?: SeparateOptions,
) => Promise<Stems>;

export interface AnalysisOutcome {
  readings: Readings;
  /** 這次有沒有用到分軌（快取或現分） */
  separated: boolean;
  /** 要分軌卻分不成（模型不在、ORT 載不起來）時的錯誤訊息 */
  separationError?: string;
  /** 轉譜不成（模型不在、tfjs 載不起來）時的錯誤訊息；notes 會是空的 */
  notesError?: string;
}

/** 轉譜這一段可以換掉的零件（測試注入假的轉譜器與記憶體快取） */
export interface NotesDeps {
  transcribe?: TranscribeFn;
  /** 預設：有 OPFS 用 OpfsNoteStore，沒有（Node）就不快取 */
  store?: NoteStore;
}

let defaultStore: NoteStore | undefined;
function storeFor(deps: NotesDeps): NoteStore | undefined {
  if (deps.store) return deps.store;
  if (!opfsAvailable()) return undefined;
  defaultStore ??= new OpfsNoteStore();
  return defaultStore;
}

/**
 * 轉譜階段（Stage 'notes'）：有分軌餵 bass + other（去掉鼓的泛音和人聲的滑音），沒有就餵混音。
 * 先查快取（key = 餵進去那份 PCM 的雜湊 + 門檻）；轉不成就回空陣列與錯誤訊息，不擋整個分析。
 */
export async function transcribeStage(
  pcm: Float32Array,
  sampleRate: number,
  stems: Stems | undefined,
  onProgress: Progress,
  deps: NotesDeps = {},
): Promise<{ notes: NoteEvent[]; error?: string }> {
  onProgress('notes', 0);
  const feed = stems ? mixStems(stems, ['bass', 'other']) : pcm;
  const store = storeFor(deps);
  let key: string | undefined;
  try {
    if (store) {
      key = await noteKey(feed, thresholdsKey(NOTE_THRESHOLDS));
      const hit = await store.get(key);
      if (hit) {
        onProgress('notes', 1);
        return { notes: hit };
      }
    }
    const notes = await (deps.transcribe ?? transcribeNotes)(feed, sampleRate, {
      thresholds: NOTE_THRESHOLDS,
      onProgress: (f) => onProgress('notes', f),
    });
    if (store && key)
      await store.put(key, notes).catch((err) => console.warn('notes cache write failed', err));
    onProgress('notes', 1);
    return { notes };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // 沒模型是預期中的情況（沒跑 setup:models、Node 測試），不吵
    if (!error.startsWith(NOTES_MODEL_MISSING)) console.warn('transcription failed; no notes', err);
    return { notes: [], error };
  }
}

/**
 * 整條流程（Worker 與 inline 共用）：
 * 要分軌且沒有現成的 → separateStems（進度報成 'separate'），成功就回報 stems 讓外面快取；
 * 分不成就 warn 一聲、當作沒有 stems 繼續分析混音。
 */
export async function runAnalysis(
  input: AnalyzeInput,
  onProgress: Progress,
  onStems?: (stems: Stems) => void,
  separateFn: SeparateFn = separateStems,
  notesDeps: NotesDeps = {},
): Promise<AnalysisOutcome> {
  let stems = input.stems;
  let separationError: string | undefined;
  if (!stems && input.separate) {
    onProgress('separate', 0);
    try {
      stems = await separateFn(input.left, input.right, {
        onProgress: (f) => onProgress('separate', f),
      });
      onStems?.(stems);
    } catch (err) {
      separationError = err instanceof Error ? err.message : String(err);
      console.warn('stem separation failed; analysing the mix instead', err);
      stems = undefined;
    }
  }
  const audio = await analyzeAudio(input.pcm, input.sampleRate, onProgress, { stems });
  const { notes, error: notesError } = await transcribeStage(
    input.pcm,
    input.sampleRate,
    stems,
    onProgress,
    notesDeps,
  );
  const kind = stems ? 'stem' : 'audio';
  let readings: Readings = {
    ...audio,
    notes,
    source: audio.source && { ...audio.source, notes: notes.length ? kind : 'none' },
  };
  // 有音符就用音符重算和弦（比 HPCP 準得多），強拍也跟著和弦換的時刻重投
  if (notes.length > 0 && audio.rhythm) {
    const chords = chordsFromNotes(notes, audio.rhythm.beats, audio.bass);
    if (chords.length > 0) {
      readings = {
        ...readings,
        chords,
        tempo: buildTempo(audio.rhythm, audio.drums, chords),
        source: readings.source && { ...readings.source, chords: kind },
      };
    }
  }
  return { readings, separated: stems !== undefined, separationError, notesError };
}

/** 不開 Worker 的版本（測試、退路）；多一個 separateFn 可注入 */
export const analyzeInline = async (
  input: AnalyzeInput,
  onProgress: Progress,
  onStems?: (stems: Stems) => void,
  onSeparationError?: (message: string) => void,
  _signal?: AbortSignal,
  separateFn: SeparateFn = separateStems,
  notesDeps: NotesDeps = {},
): Promise<Readings> => {
  const out = await runAnalysis(input, onProgress, onStems, separateFn, notesDeps);
  if (out.separationError) onSeparationError?.(out.separationError);
  return out.readings;
};

export type WorkerRequest = { id: number; input: AnalyzeInput };
export type WorkerMessage =
  | { id: number; type: 'progress'; stage: Parameters<Progress>[0]; fraction: number }
  | { id: number; type: 'stems'; stems: Stems }
  | { id: number; type: 'done'; readings: Readings; separationError?: string }
  | { id: number; type: 'error'; message: string };

let nextId = 1;

const abortError = () => new DOMException('analysis aborted', 'AbortError');

/** 在 module Worker 裡跑 runAnalysis；Float32Array 用 transfer 搬過去（主執行緒之後不再碰它們） */
export const analyzeInWorker: AnalyzeFn = (input, onProgress, onStems, onSeparationError, signal) =>
  new Promise<Readings>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const id = nextId++;
    const onAbort = () => {
      worker.terminate();
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const finish = () => {
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === 'progress') onProgress(m.stage, m.fraction);
      else if (m.type === 'stems') onStems?.(m.stems);
      else if (m.type === 'done') {
        finish();
        if (m.separationError) onSeparationError?.(m.separationError);
        resolve(m.readings);
      } else {
        finish();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      finish();
      reject(e.error ?? new Error(e.message));
    };
    worker.onmessageerror = () => {
      finish();
      reject(new Error('worker message could not be deserialized'));
    };
    const transfer = new Set<ArrayBufferLike>([
      input.pcm.buffer,
      input.left.buffer,
      input.right.buffer,
    ]);
    if (input.stems)
      for (const k of ['drums', 'bass', 'other', 'vocals'] as const)
        transfer.add(input.stems[k].buffer);
    const msg: WorkerRequest = { id, input };
    worker.postMessage(
      msg,
      [...transfer].filter((b): b is ArrayBuffer => b instanceof ArrayBuffer),
    );
  });

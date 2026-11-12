import { analyzeAudio, type Progress } from './analyzeAudio';
import { type SeparateOptions, separateStems } from './stems/separate';
import type { Stems } from './stems/types';
import type { Readings } from './types';

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
  const readings = await analyzeAudio(input.pcm, input.sampleRate, onProgress, { stems });
  return { readings, separated: stems !== undefined, separationError };
}

/** 不開 Worker 的版本（測試、退路）；多一個 separateFn 可注入 */
export const analyzeInline = async (
  input: AnalyzeInput,
  onProgress: Progress,
  onStems?: (stems: Stems) => void,
  onSeparationError?: (message: string) => void,
  _signal?: AbortSignal,
  separateFn: SeparateFn = separateStems,
): Promise<Readings> => {
  const out = await runAnalysis(input, onProgress, onStems, separateFn);
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

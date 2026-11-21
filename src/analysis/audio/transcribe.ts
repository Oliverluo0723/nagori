import type { NoteEvent } from '../types';
import {
  fromBasicPitch,
  NOTE_THRESHOLDS,
  type NoteThresholds,
  type RawNote,
  resampleForBasicPitch,
} from './notes';

/**
 * Basic Pitch 轉譜：載模型、跑推論。@tensorflow/tfjs 與 @spotify/basic-pitch 只在這裡動態 import，
 * 只在瀏覽器／Worker 跑；Node 測試給 runAnalysis 注入假的 TranscribeFn（和 SeparateFn 同一套做法）。
 */

/** 模型由 `pnpm setup:models` 從 node_modules 複製進 public/models/basic-pitch/（部署在子路徑時跟著 BASE_URL） */
export const NOTES_MODEL_URL = `${import.meta.env.BASE_URL}models/basic-pitch/model.json`;
/** 模型不在時丟的錯誤訊息開頭 */
export const NOTES_MODEL_MISSING = 'notes model missing';

export interface TranscribeOptions {
  thresholds?: NoteThresholds;
  modelUrl?: string;
  /** 0–1 */
  onProgress?: (fraction: number) => void;
}

/** pcm 是任意取樣率的單聲道；回傳整理好的 NoteEvent[] */
export type TranscribeFn = (
  pcm: Float32Array,
  sampleRate: number,
  opts?: TranscribeOptions,
) => Promise<NoteEvent[]>;

/** model.json 在不在（Vite dev 對不存在的檔回 200 的 index.html，要排除） */
export async function notesModelAvailable(
  url: string = NOTES_MODEL_URL,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchFn(url, { method: 'HEAD' });
    if (!res.ok) return false;
    return !(res.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

type Tf = typeof import('@tensorflow/tfjs');
type GraphModel = Awaited<ReturnType<Tf['loadGraphModel']>>;

/** 模型與 backend 只載一次（同一個 Worker／頁面裡第二首歌直接用） */
let loaded: Promise<{ tf: Tf; model: GraphModel; backend: string }> | undefined;

async function loadModel(url: string) {
  loaded ??= (async () => {
    const tf = await import('@tensorflow/tfjs');
    // webgl 優先（Worker 裡用 OffscreenCanvas）；起不來就退 cpu，結果允許有浮點差異
    let backend = 'cpu';
    try {
      if (await tf.setBackend('webgl')) backend = 'webgl';
    } catch {
      /* 退 cpu */
    }
    if (backend === 'cpu') await tf.setBackend('cpu');
    await tf.ready();
    const model = await tf.loadGraphModel(url);
    return { tf, model, backend };
  })();
  try {
    return await loaded;
  } catch (err) {
    loaded = undefined;
    throw err;
  }
}

export const transcribeNotes: TranscribeFn = async (pcm, sampleRate, opts = {}) => {
  const th = opts.thresholds ?? NOTE_THRESHOLDS;
  const url = opts.modelUrl ?? NOTES_MODEL_URL;
  const onProgress = opts.onProgress ?? (() => {});
  if (!(await notesModelAvailable(url))) throw new Error(`${NOTES_MODEL_MISSING}: ${url}`);
  const t0 = performance.now();
  const { tf, model, backend } = await loadModel(url);
  const bp = await import('@spotify/basic-pitch');
  const audio = resampleForBasicPitch(pcm, sampleRate);
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  const basic = new bp.BasicPitch(Promise.resolve(model));
  // evaluateModel 一段一段跑、每段都 await 讀回，主執行緒跑時中間會讓出事件迴圈
  tf.engine().startScope();
  try {
    await basic.evaluateModel(
      audio,
      (f, o, c) => {
        for (const row of f) frames.push(row);
        for (const row of o) onsets.push(row);
        for (const row of c) contours.push(row);
      },
      (p) => onProgress(Math.min(0.95, p * 0.95)),
    );
  } finally {
    tf.engine().endScope();
  }
  const raw: RawNote[] = bp.noteFramesToTime(
    bp.addPitchBendsToNoteEvents(
      contours,
      bp.outputToNotesPoly(
        frames,
        onsets,
        th.onset,
        th.frame,
        th.minFrames,
        true,
        null,
        null,
        true,
        th.energyTolerance,
      ),
    ),
  );
  const notes = fromBasicPitch(raw);
  onProgress(1);
  // 時間試驗看這行（§4.3）
  console.info(
    `transcribe: ${notes.length} notes, ${(audio.length / 22050).toFixed(0)} s audio in ${((performance.now() - t0) / 1000).toFixed(1)} s (${backend})`,
  );
  return notes;
};

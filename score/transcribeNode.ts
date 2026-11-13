import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fromBasicPitch, NOTE_THRESHOLDS, type RawNote, resampleForBasicPitch } from '../src/analysis/audio/notes';
import type { TranscribeFn } from '../src/analysis/audio/transcribe';

/**
 * Node 版的 Basic Pitch 轉譜（給 `pnpm score` 用）：模型從 public/models/basic-pitch/ 讀檔，
 * tfjs 走 cpu backend。後處理跟瀏覽器版（transcribe.ts）一模一樣。
 */
const require = createRequire(import.meta.url);
const MODEL_DIR = join(import.meta.dirname, '..', 'public', 'models', 'basic-pitch');

type Tf = typeof import('@tensorflow/tfjs');
type Bp = typeof import('@spotify/basic-pitch');
type GraphModel = Awaited<ReturnType<Tf['loadGraphModel']>>;

let loaded: Promise<{ tf: Tf; bp: Bp; model: GraphModel }> | undefined;

async function load() {
  loaded ??= (async () => {
    // 走 CommonJS 入口：tfjs 的 ESM dist 省略副檔名，Node 直接吃不下
    const tf = require('@tensorflow/tfjs') as Tf;
    const bp = require('@spotify/basic-pitch') as Bp;
    await tf.setBackend('cpu');
    await tf.ready();
    const json = JSON.parse(readFileSync(join(MODEL_DIR, 'model.json'), 'utf8'));
    const weightSpecs = json.weightsManifest.flatMap((g: { weights: unknown[] }) => g.weights);
    const buf = Buffer.concat(
      json.weightsManifest.flatMap((g: { paths: string[] }) =>
        g.paths.map((p) => readFileSync(join(MODEL_DIR, p))),
      ),
    );
    const weightData = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const model = await tf.loadGraphModel({
      load: async () => ({
        modelTopology: json.modelTopology,
        weightSpecs,
        weightData,
        format: json.format,
        generatedBy: json.generatedBy,
        convertedBy: json.convertedBy,
        signature: json.signature,
        userDefinedMetadata: json.userDefinedMetadata,
      }),
    });
    return { tf, bp, model };
  })();
  return loaded;
}

export const transcribeNode: TranscribeFn = async (pcm, sampleRate, opts = {}) => {
  const th = opts.thresholds ?? NOTE_THRESHOLDS;
  const { tf, bp, model } = await load();
  const audio = resampleForBasicPitch(pcm, sampleRate);
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  const basic = new bp.BasicPitch(Promise.resolve(model));
  tf.engine().startScope();
  try {
    await basic.evaluateModel(
      audio,
      (f, o, c) => {
        for (const row of f) frames.push(row);
        for (const row of o) onsets.push(row);
        for (const row of c) contours.push(row);
      },
      (p) => opts.onProgress?.(p),
    );
  } finally {
    tf.engine().endScope();
  }
  const raw: RawNote[] = bp.noteFramesToTime(
    bp.addPitchBendsToNoteEvents(
      contours,
      bp.outputToNotesPoly(frames, onsets, th.onset, th.frame, th.minFrames),
    ),
  );
  return fromBasicPitch(raw);
};

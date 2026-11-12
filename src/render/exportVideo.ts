import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  canEncodeAudio,
  canEncodeVideo,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
} from 'mediabunny';
import p5 from 'p5';
import type { Readings } from '../analysis/types';
import { renderFrame } from '../compose/render';
import { P5SurfaceProvider } from '../compose/surface-p5';
import { themes } from '../compose/themes';
import type { Composition } from '../compose/types';
import { type ExportRange, frameCount, frameTime } from './range';
import { type ClipFiles, ExportVideos } from './videoExport';

export const EXPORT_WIDTH = 1080;
export const EXPORT_HEIGHT = 1920;
export const EXPORT_FPS = 30;
const AUDIO_RATE = 48000;

export interface ExportOptions {
  composition: Composition;
  readings: Readings;
  /** 那首歌的 blob URL（預覽 <audio> 用的同一個） */
  audioUrl: string;
  range: ExportRange;
  /** 影片格用到的檔案（clipId → 檔案） */
  clips?: ClipFiles;
  fps?: number;
  /** 0..1 */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

function abortError(): DOMException {
  return new DOMException('export aborted', 'AbortError');
}

/** instance mode 的 p5 只拿來 createGraphics；setup 跑完才能用。 */
function createSketch(): Promise<p5> {
  return new Promise((resolve) => {
    const sketch = new p5((p: p5) => {
      p.setup = () => {
        p.noCanvas();
        p.noLoop();
        p.pixelDensity(1);
        // setup 在建構子裡可能同步跑，sketch 變數那時還沒指派
        queueMicrotask(() => resolve(sketch));
      };
    });
  });
}

/** 解碼整首、切出範圍那段。用 48 kHz 是 AAC 最穩的取樣率。 */
async function sliceAudio(url: string, range: ExportRange): Promise<AudioBuffer> {
  const bytes = await (await fetch(url)).arrayBuffer();
  const ctx = new OfflineAudioContext(2, 1, AUDIO_RATE);
  const full = await ctx.decodeAudioData(bytes);
  const from = Math.round(range.start * AUDIO_RATE);
  const to = Math.min(full.length, Math.round(range.end * AUDIO_RATE));
  const out = new AudioBuffer({
    numberOfChannels: full.numberOfChannels,
    length: Math.max(1, to - from),
    sampleRate: AUDIO_RATE,
  });
  for (let c = 0; c < full.numberOfChannels; c++) {
    out.copyToChannel(full.getChannelData(c).subarray(from, to), c);
  }
  return out;
}

/**
 * 逐幀重畫輸出 mp4（H.264 + AAC，1080×1920）。
 * 跟預覽走同一個 renderFrame；look 的尺寸全都跟著 h 縮放，所以畫大張就是更銳利的同一張圖。
 * 同一組輸入每次畫出同樣的幀（幀時間只由 range 與 fps 決定）。
 */
export async function exportVideo(opts: ExportOptions): Promise<Blob> {
  const { composition, readings, audioUrl, range, signal } = opts;
  const fps = opts.fps ?? EXPORT_FPS;
  const progress = opts.onProgress ?? (() => {});
  const w = EXPORT_WIDTH;
  const h = EXPORT_HEIGHT;

  if (!(await canEncodeVideo('avc', { width: w, height: h, quality: QUALITY_HIGH }))) {
    throw new Error('這個瀏覽器不能編 H.264（請用 Chrome）');
  }
  if (!(await canEncodeAudio('aac', { sampleRate: AUDIO_RATE, numberOfChannels: 2 }))) {
    throw new Error('這個瀏覽器不能編 AAC（請用 Chrome）');
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');

  const audio = await sliceAudio(audioUrl, range);
  const sketch = await createSketch();
  const surfaces = new P5SurfaceProvider(sketch, () => themes[composition.themeId]?.glow ?? false);
  const n = frameCount(range, fps);
  const times = Array.from({ length: n }, (_, i) => frameTime(range, fps, i));
  const videos = await ExportVideos.open(composition.root, opts.clips ?? {}, times);

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });
  const video = new CanvasSource(canvas, { codec: 'avc', quality: QUALITY_HIGH });
  const sound = new AudioBufferSource({ codec: 'aac', quality: QUALITY_HIGH });
  output.addVideoTrack(video, { frameRate: fps });
  output.addAudioTrack(sound);

  try {
    await output.start();
    await sound.add(audio);
    sound.close();

    for (let i = 0; i < n; i++) {
      if (signal?.aborted) throw abortError();
      await videos.advance();
      renderFrame({
        composition,
        t: times[i],
        readings,
        surfaces,
        target: { w, h, ctx },
        videos,
      });
      await video.add(i / fps, 1 / fps);
      progress((i + 1) / n);
    }
    video.close();
    await output.finalize();
  } catch (err) {
    if (output.state !== 'finalized') await output.cancel().catch(() => {});
    throw err;
  } finally {
    await videos.close();
    surfaces.destroy();
    sketch.remove();
  }

  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new Error('輸出失敗：沒有資料');
  return new Blob([buffer], { type: 'video/mp4' });
}

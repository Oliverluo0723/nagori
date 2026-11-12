import { ALL_FORMATS, BlobSource, CanvasSink, Input, type WrappedCanvas } from 'mediabunny';
import { cellsOf } from '../compose/layout';
import type { LayoutNode } from '../compose/types';
import { clipTime, type VideoFrame, type VideoProvider } from '../compose/video';

/** 輸出要讀的影片檔（clipId → 檔案）。 */
export type ClipFiles = Record<string, Blob>;

interface Track {
  input: Input;
  frames: AsyncGenerator<WrappedCanvas | null, void, unknown>;
  current: VideoFrame | null;
}

/**
 * 輸出用的影片：每個影片格開一個解碼器，依所有幀的時間點依序取幀。
 * 時間只由幀號決定，所以同一組輸入每次拿到同一幀。
 */
export class ExportVideos implements VideoProvider {
  private constructor(private readonly tracks: Map<string, Track>) {}

  static async open(root: LayoutNode, files: ClipFiles, times: number[]): Promise<ExportVideos> {
    const tracks = new Map<string, Track>();
    try {
      for (const cell of cellsOf(root)) {
        const layer = cell.video;
        const file = layer ? files[layer.clipId] : undefined;
        if (!layer || !file) continue;
        const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
        const video = await input.getPrimaryVideoTrack();
        if (!video) {
          input.dispose();
          continue;
        }
        const duration = await video.computeDuration();
        // poolSize：拿到的幀畫完就不再用，重複使用幾張畫布就好
        const sink = new CanvasSink(video, { poolSize: 2 });
        const frames = sink.canvasesAtTimestamps(times.map((t) => clipTime(t, layer, duration)));
        tracks.set(cell.id, { input, frames, current: null });
      }
    } catch (err) {
      for (const tr of tracks.values()) tr.input.dispose();
      throw err;
    }
    return new ExportVideos(tracks);
  }

  /** 換到下一個時間點；取不到幀（例如在第一幀之前）就沿用上一幀。 */
  async advance(): Promise<void> {
    for (const tr of this.tracks.values()) {
      const next = await tr.frames.next();
      const wrapped = next.done ? null : next.value;
      if (wrapped) {
        tr.current = { image: wrapped.canvas, w: wrapped.canvas.width, h: wrapped.canvas.height };
      }
    }
  }

  frame(cellId: string): VideoFrame | null {
    return this.tracks.get(cellId)?.current ?? null;
  }

  async close(): Promise<void> {
    for (const tr of this.tracks.values()) {
      await tr.frames.return(undefined).catch(() => {});
      tr.input.dispose();
    }
    this.tracks.clear();
  }
}

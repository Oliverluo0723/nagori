import { cellsOf } from '../compose/layout';
import type { LayoutNode } from '../compose/types';
import { clipRunning, clipTime, type VideoFrame, type VideoProvider } from '../compose/video';

/** 預覽只需要影片的網址；輸出另外直接讀檔案。 */
export type ClipUrls = Record<string, string>;

interface Entry {
  el: HTMLVideoElement;
  clipId: string;
}

/** 播放中容許的漂移；超過才拉回，免得一直 seek 造成卡頓。 */
const PLAY_DRIFT = 0.2;
/** 暫停時要對到哪一幀，誤差小於半幀就不動。 */
const PAUSE_DRIFT = 1 / 60;

/**
 * 預覽用的影片：每個影片格一個靜音的 <video>。
 * 歌在播、影片在範圍內就讓它自己播（順），漂移太多才 seek；其餘時候停在對應那一幀。
 * 輸出不走這裡（要逐幀精確），見 videoExport.ts。
 */
export class PreviewVideos implements VideoProvider {
  private readonly entries = new Map<string, Entry>();
  private urls: ClipUrls = {};

  /** 影片 seek 完、載好時叫一聲，讓暫停中的預覽重畫。 */
  constructor(private readonly onFrameReady: () => void) {}

  setClips(urls: ClipUrls): void {
    this.urls = urls;
  }

  /** 每畫一幀前呼叫：建立／收掉 <video>，對齊到歌的時間。 */
  sync(root: LayoutNode, t: number, playing: boolean): void {
    const live = new Set<string>();
    for (const cell of cellsOf(root)) {
      const layer = cell.video;
      const url = layer ? this.urls[layer.clipId] : undefined;
      if (!layer || !url) continue;
      live.add(cell.id);
      const entry = this.ensure(cell.id, layer.clipId, url);
      const el = entry.el;
      if (el.readyState < HTMLMediaElement.HAVE_METADATA) continue;
      const vt = clipTime(t, layer, el.duration);
      if (playing && clipRunning(t, layer, el.duration)) {
        if (el.paused) {
          el.currentTime = vt;
          void el.play().catch(() => {});
        } else if (Math.abs(el.currentTime - vt) > PLAY_DRIFT) {
          el.currentTime = vt;
        }
      } else {
        if (!el.paused) el.pause();
        if (!el.seeking && Math.abs(el.currentTime - vt) > PAUSE_DRIFT) el.currentTime = vt;
      }
    }
    for (const [cellId, entry] of this.entries) {
      if (!live.has(cellId)) this.drop(cellId, entry);
    }
  }

  pauseAll(): void {
    for (const { el } of this.entries.values()) el.pause();
  }

  frame(cellId: string): VideoFrame | null {
    const el = this.entries.get(cellId)?.el;
    if (!el || el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    return { image: el, w: el.videoWidth, h: el.videoHeight };
  }

  destroy(): void {
    for (const [cellId, entry] of this.entries) this.drop(cellId, entry);
  }

  private ensure(cellId: string, clipId: string, url: string): Entry {
    const old = this.entries.get(cellId);
    if (old && old.clipId === clipId) return old;
    if (old) this.drop(cellId, old);
    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.preload = 'auto';
    el.src = url;
    el.addEventListener('loadeddata', this.onFrameReady);
    el.addEventListener('seeked', this.onFrameReady);
    const entry = { el, clipId };
    this.entries.set(cellId, entry);
    return entry;
  }

  private drop(cellId: string, entry: Entry): void {
    entry.el.removeEventListener('loadeddata', this.onFrameReady);
    entry.el.removeEventListener('seeked', this.onFrameReady);
    entry.el.pause();
    entry.el.removeAttribute('src');
    entry.el.load();
    this.entries.delete(cellId);
  }
}

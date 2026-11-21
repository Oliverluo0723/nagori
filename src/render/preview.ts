import p5 from 'p5';
import type { Readings } from '../analysis/types';
import { renderFrame } from '../compose/render';
import { P5SurfaceProvider } from '../compose/surface-p5';
import { themes } from '../compose/themes';
import type { Composition } from '../compose/types';
import { type ClipUrls, PreviewVideos } from './videoPreview';

/** 即時彈奏：時間與讀數由它給，不讀音檔。 */
export interface LiveSource {
  /** 現在的時間（秒） */
  now(): number;
  readings(now: number): Readings;
}

export interface Preview {
  setComposition(c: Composition): void;
  setReadings(r: Readings): void;
  /** 影片清單（clipId → blob URL） */
  setClips(urls: ClipUrls): void;
  play(): Promise<void>;
  pause(): void;
  seek(t: number): void;
  /**
   * 有來源：暫停音檔，畫面迴圈一直跑，時間和讀數都向來源要。
   * null：停迴圈，回到讀 audio 和 setReadings 給的讀數。
   */
  setLive(source: LiveSource | null): void;
  destroy(): void;
}

export interface PreviewOptions {
  host: HTMLElement;
  audio: HTMLAudioElement;
  width: number;
  /** 音檔播到底時呼叫；迴圈已經停了。 */
  onEnded?: () => void;
}

/** 開發模式：最近 60 幀的畫圖毫秒數放在 window.__otoFrameMs，量絲滑度用。 */
function recordFrameMs(ms: number): void {
  const w = window as unknown as { __otoFrameMs?: number[] };
  if (!w.__otoFrameMs) w.__otoFrameMs = [];
  const list = w.__otoFrameMs;
  list.push(ms);
  if (list.length > 60) list.shift();
}

/**
 * 預覽：播放器報告時間，畫面查 Readings 畫對應那一幀。
 * 跟輸出走同一個 renderFrame，只是尺寸較小。
 */
export function createPreview(opts: PreviewOptions): Preview {
  const { host, audio, width, onEnded } = opts;
  const height = Math.round((width * 16) / 9);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');

  let composition: Composition | null = null;
  let readings: Readings | null = null;
  let live: LiveSource | null = null;
  let raf = 0;
  let surfaces: P5SurfaceProvider | null = null;
  // 暫停中影片 seek 完要補畫一次；播放中迴圈自己會畫
  const videos = new PreviewVideos(() => {
    if (!raf) drawFrame();
  });

  // instance mode 的 p5 只拿來 createGraphics，自己不畫。
  const sketch = new p5((p: p5) => {
    p.setup = () => {
      p.noCanvas();
      p.noLoop();
      // 固定 1 倍：glow 的 shadowBlur 不受 transform 影響，跟著 DPR 走會讓發光量隨螢幕改變
      p.pixelDensity(1);
      surfaces = new P5SurfaceProvider(p, () =>
        composition ? (themes[composition.themeId]?.glow ?? false) : false,
      );
    };
  });

  const drawFrame = () => {
    const t = live ? live.now() : audio.currentTime;
    const r = live ? live.readings(t) : readings;
    if (!composition || !r || !surfaces) return;
    const t0 = performance.now();
    videos.sync(composition.root, t, raf !== 0 && !live && !audio.paused);
    renderFrame({
      composition,
      t,
      readings: r,
      surfaces,
      target: { w: width, h: height, ctx },
      videos,
    });
    if (import.meta.env.DEV) recordFrameMs(performance.now() - t0);
  };

  const loop = () => {
    drawFrame();
    raf = requestAnimationFrame(loop);
  };

  const stopLoop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const handleEnded = () => {
    stopLoop();
    videos.pauseAll();
    drawFrame();
    onEnded?.();
  };
  audio.addEventListener('ended', handleEnded);

  return {
    setComposition(c) {
      // 主題換了，glow 設定跟著變：重建 surfaces 最單純。
      const themeChanged = composition?.themeId !== c.themeId;
      composition = c;
      if (themeChanged && surfaces) {
        surfaces.destroy();
        surfaces = null;
        const p = sketch as unknown as p5;
        surfaces = new P5SurfaceProvider(p, () => themes[c.themeId]?.glow ?? false);
      }
      drawFrame();
    },
    setReadings(r) {
      readings = r;
      drawFrame();
    },
    setClips(urls) {
      videos.setClips(urls);
      drawFrame();
    },
    async play() {
      if (live) return;
      await audio.play();
      stopLoop();
      loop();
    },
    pause() {
      audio.pause();
      if (!live) stopLoop();
      videos.pauseAll();
      drawFrame();
    },
    seek(t) {
      audio.currentTime = t;
      drawFrame();
    },
    setLive(source) {
      live = source;
      audio.pause();
      videos.pauseAll();
      stopLoop();
      if (live) loop();
      else drawFrame();
    },
    destroy() {
      stopLoop();
      audio.removeEventListener('ended', handleEnded);
      surfaces?.destroy();
      videos.destroy();
      sketch.remove();
      canvas.remove();
    },
  };
}

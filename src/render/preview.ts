import p5 from 'p5';
import type { Readings } from '../analysis/types';
import { renderFrame } from '../compose/render';
import { P5SurfaceProvider } from '../compose/surface-p5';
import { themes } from '../compose/themes';
import type { Composition } from '../compose/types';

export interface Preview {
  setComposition(c: Composition): void;
  setReadings(r: Readings): void;
  play(): Promise<void>;
  pause(): void;
  seek(t: number): void;
  destroy(): void;
}

export interface PreviewOptions {
  host: HTMLElement;
  audio: HTMLAudioElement;
  width: number;
  /** 音檔播到底時呼叫；迴圈已經停了。 */
  onEnded?: () => void;
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
  let raf = 0;
  let surfaces: P5SurfaceProvider | null = null;

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
    if (!composition || !readings || !surfaces) return;
    renderFrame({
      composition,
      t: audio.currentTime,
      readings,
      surfaces,
      target: { w: width, h: height, ctx },
    });
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
    async play() {
      await audio.play();
      stopLoop();
      loop();
    },
    pause() {
      audio.pause();
      stopLoop();
      drawFrame();
    },
    seek(t) {
      audio.currentTime = t;
      drawFrame();
    },
    destroy() {
      stopLoop();
      audio.removeEventListener('ended', handleEnded);
      surfaces?.destroy();
      sketch.remove();
      canvas.remove();
    },
  };
}

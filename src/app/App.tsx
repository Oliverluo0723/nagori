import { useEffect, useMemo, useRef, useState } from 'react';
import { bpmAt } from '../analysis/tempo';
import { themes } from '../compose/themes';
import type { Composition } from '../compose/types';
import { createPreview, type Preview } from '../render/preview';
import { useProject } from './useProject';

const PREVIEW_WIDTH = 540;

const ERROR_TEXT = {
  'need-midi': '需要同名 .mid',
  'need-audio': '需要音檔',
  'parse-failed': '解析失敗',
} as const;

export function App() {
  const { state, drop } = useProject();
  const [themeId, setThemeId] = useState<string>('darkGlow');
  const [playing, setPlaying] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const previewRef = useRef<Preview | null>(null);

  const composition = useMemo<Composition>(
    () => ({
      aspect: { w: 9, h: 16 },
      root: { kind: 'cell', id: 'c1', lookId: 'rings', params: {} },
      themeId,
    }),
    [themeId],
  );

  useEffect(() => {
    const host = hostRef.current;
    const audio = audioRef.current;
    if (!host || !audio) return;
    const preview = createPreview({ host, audio, width: PREVIEW_WIDTH });
    previewRef.current = preview;
    return () => {
      preview.destroy();
      previewRef.current = null;
    };
  }, []);

  useEffect(() => {
    previewRef.current?.setComposition(composition);
  }, [composition]);

  useEffect(() => {
    if (state.status !== 'ready') return;
    const audio = audioRef.current;
    if (audio) audio.src = state.audioUrl;
    setPlaying(false);
    previewRef.current?.setReadings(state.readings);
  }, [state]);

  const togglePlay = async () => {
    const preview = previewRef.current;
    if (!preview || state.status !== 'ready') return;
    if (playing) {
      preview.pause();
      setPlaying(false);
    } else {
      await preview.play();
      setPlaying(true);
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 整頁是拖放區，沒有鍵盤對應的操作
    <div
      style={styles.page}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        drop(Array.from(e.dataTransfer.files));
      }}
    >
      <aside style={styles.side}>
        <h1 style={styles.logo}>
          oto<span style={{ color: '#ff4a1c' }}>.</span>
        </h1>
        <p style={styles.hint}>把 mp3 與同名 .mid 一起拖進這個視窗</p>

        {state.status === 'loading' && <p>分析中…</p>}
        {state.status === 'error' && <p style={styles.error}>{ERROR_TEXT[state.reason]}</p>}
        {state.status === 'ready' && (
          <dl style={styles.readings}>
            <dt>歌</dt>
            <dd>{state.name}</dd>
            <dt>BPM</dt>
            <dd>{Math.round(bpmAt(state.readings.tempo, 0))}</dd>
            <dt>Hits</dt>
            <dd>{state.readings.drums.length}</dd>
            <dt>長度</dt>
            <dd>{state.readings.duration.toFixed(1)} s</dd>
          </dl>
        )}
        {state.status === 'ready' && state.readings.drums.length === 0 && (
          <p style={styles.error}>找不到鼓軌</p>
        )}

        <div style={styles.row}>
          {Object.values(themes).map((th) => (
            <button
              key={th.id}
              type="button"
              onClick={() => setThemeId(th.id)}
              style={{ ...styles.button, ...(th.id === themeId ? styles.buttonOn : {}) }}
            >
              {th.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={togglePlay}
          disabled={state.status !== 'ready'}
          style={{ ...styles.button, ...styles.play }}
        >
          {playing ? '暫停' : '播放'}
        </button>
        {/* biome-ignore lint/a11y/useMediaCaption: 預覽用的音軌，無字幕 */}
        <audio ref={audioRef} />
      </aside>
      <main style={styles.main}>
        <div ref={hostRef} style={styles.host} />
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: 'flex',
    minHeight: '100vh',
    background: '#0b0b0b',
    color: '#efece4',
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  side: {
    width: 260,
    padding: 24,
    borderRight: '1px solid #222',
    display: 'grid',
    gap: 12,
    alignContent: 'start',
  },
  logo: { fontSize: 28, margin: 0 },
  hint: { color: '#7a7a7a', fontSize: 13, margin: 0 },
  error: { color: '#ff4a1c', margin: 0 },
  readings: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: '4px 12px',
    fontFamily: 'ui-monospace, monospace',
    fontSize: 13,
    margin: 0,
  },
  row: { display: 'flex', gap: 8 },
  button: {
    background: '#1a1a1a',
    color: '#efece4',
    border: '1px solid #333',
    padding: '8px 12px',
    cursor: 'pointer',
  },
  buttonOn: { background: '#efece4', color: '#0f0f0f' },
  play: { background: '#ff4a1c', color: '#0f0f0f', border: 'none', fontWeight: 700 },
  main: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  host: { boxShadow: '0 8px 40px rgba(0,0,0,.5)' },
};

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Stage } from '../analysis/analyzeAudio';
import { bpmAt } from '../analysis/tempo';
import type { SourceKind } from '../analysis/types';
import { themes } from '../compose/themes';
import type { Composition } from '../compose/types';
import { looks } from '../looks/registry';
import { createPreview, type Preview } from '../render/preview';
import { useProject } from './useProject';

const PREVIEW_WIDTH = 540;

const ERROR_TEXT = {
  'need-audio': '需要音檔',
  'parse-failed': '解析失敗',
  'no-beat': '分析不到節拍',
  aborted: '已取消',
} as const;

const SOURCE_TEXT: Record<SourceKind, string> = {
  midi: 'MIDI',
  audio: '音訊',
  stem: '分軌',
  none: '無',
};

const STAGE_TEXT: Record<Stage, string> = {
  decode: '解碼音檔',
  separate: '分軌（第一次約一分鐘）',
  spectrum: '算頻譜',
  rhythm: '找節拍',
  drums: '找鼓點',
  chords: '找和弦',
  bass: '找 bass',
};

export function App() {
  const { state, drop, setTempo } = useProject();
  const [themeId, setThemeId] = useState<string>('darkGlow');
  const [lookId, setLookId] = useState<string>('rings');
  const [playing, setPlaying] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const previewRef = useRef<Preview | null>(null);

  const composition = useMemo<Composition>(
    () => ({
      aspect: { w: 9, h: 16 },
      root: { kind: 'cell', id: 'c1', lookId, params: {} },
      themeId,
    }),
    [themeId, lookId],
  );

  useEffect(() => {
    const host = hostRef.current;
    const audio = audioRef.current;
    if (!host || !audio) return;
    const preview = createPreview({
      host,
      audio,
      width: PREVIEW_WIDTH,
      onEnded: () => setPlaying(false),
    });
    previewRef.current = preview;
    return () => {
      preview.destroy();
      previewRef.current = null;
    };
  }, []);

  useEffect(() => {
    previewRef.current?.setComposition(composition);
  }, [composition]);

  const audioUrl = state.status === 'ready' ? state.audioUrl : null;
  useEffect(() => {
    // 任何非 ready 的狀態（分析中、錯誤）都先停下舊歌
    previewRef.current?.pause();
    setPlaying(false);
    const audio = audioRef.current;
    if (audio && audioUrl) audio.src = audioUrl;
  }, [audioUrl]);

  useEffect(() => {
    if (state.status === 'ready') previewRef.current?.setReadings(state.readings);
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

  const ready = state.status === 'ready' ? state : null;
  const tempo = ready?.readings.tempo;
  const bpm = tempo ? Math.round(bpmAt(tempo, 0) * 10) / 10 : 0;
  const offset = tempo?.offset ?? 0;
  const beat = bpm > 0 ? 60 / bpm : 0.5;
  const candidates = ready?.readings.rhythm?.candidates ?? [];

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
        <p style={styles.hint}>把音檔拖進這個視窗（有 .mid 一起拖更準），或</p>
        <input
          type="file"
          multiple
          accept=".mp3,.wav,.aiff,.aif,.flac,.m4a,.ogg,.mid,.midi"
          onChange={(e) => {
            if (e.target.files) drop(Array.from(e.target.files));
          }}
          style={styles.file}
        />

        {state.status === 'analyzing' && (
          <div>
            <p style={styles.hint}>
              分析中：{STAGE_TEXT[state.stage]} {Math.round(state.fraction * 100)}%
            </p>
            <div style={styles.bar}>
              <div style={{ ...styles.barFill, width: `${Math.round(state.fraction * 100)}%` }} />
            </div>
          </div>
        )}
        {state.status === 'error' && <p style={styles.error}>{ERROR_TEXT[state.reason]}</p>}
        {ready && (
          <dl style={styles.readings}>
            <dt>歌</dt>
            <dd>{ready.name}</dd>
            <dt>BPM</dt>
            <dd>{bpm}</dd>
            <dt>調</dt>
            <dd>{ready.readings.key?.name ?? '–'}</dd>
            <dt>Hits</dt>
            <dd>{ready.readings.drums.length}</dd>
            <dt>和弦</dt>
            <dd>{ready.readings.chords?.length ?? 0}</dd>
            <dt>Bass</dt>
            <dd>{ready.readings.bass?.length ?? 0}</dd>
            <dt>長度</dt>
            <dd>{ready.readings.duration.toFixed(1)} s</dd>
            <dt>來源</dt>
            <dd style={{ fontSize: 11 }}>
              {ready.readings.source
                ? Object.entries(ready.readings.source)
                    .map(([k, v]) => `${k}:${SOURCE_TEXT[v as SourceKind]}`)
                    .join(' ')
                : '–'}
            </dd>
          </dl>
        )}
        {ready && ready.readings.drums.length === 0 && <p style={styles.error}>找不到鼓</p>}
        {ready?.notes.map((n) => (
          <p key={n} style={styles.note}>
            {n}
          </p>
        ))}

        {ready && candidates.length > 0 && (
          <div>
            <div style={styles.label}>BPM 候選</div>
            <div style={styles.wrap}>
              {candidates.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setTempo(c, offset)}
                  style={{ ...styles.button, ...(Math.abs(c - bpm) < 0.05 ? styles.buttonOn : {}) }}
                >
                  {c}
                </button>
              ))}
            </div>
            <div style={styles.label}>第一拍 {Math.round(offset * 1000)} ms</div>
            <div style={styles.wrap}>
              {[
                ['−1 拍', -beat],
                ['−10 ms', -0.01],
                ['+10 ms', 0.01],
                ['+1 拍', beat],
              ].map(([label, d]) => (
                <button
                  key={label as string}
                  type="button"
                  onClick={() => setTempo(bpm, offset + (d as number))}
                  style={styles.button}
                >
                  {label as string}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={styles.looks}>
          {Object.values(looks)
            .sort((a, b) => a.number - b.number)
            .map((lk) => (
              <button
                key={lk.id}
                type="button"
                onClick={() => setLookId(lk.id)}
                style={{ ...styles.button, ...(lk.id === lookId ? styles.buttonOn : {}) }}
              >
                <span style={styles.num}>{String(lk.number).padStart(2, '0')}</span> {lk.name}
              </button>
            ))}
        </div>

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
    width: 280,
    padding: 24,
    borderRight: '1px solid #222',
    display: 'grid',
    gap: 12,
    alignContent: 'start',
    overflowY: 'auto',
  },
  logo: { fontSize: 28, margin: 0 },
  hint: { color: '#7a7a7a', fontSize: 13, margin: 0 },
  error: { color: '#ff4a1c', margin: 0 },
  note: { color: '#8a8a8a', margin: 0, fontSize: 11 },
  readings: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: '4px 12px',
    fontFamily: 'ui-monospace, monospace',
    fontSize: 13,
    margin: 0,
  },
  label: {
    color: '#7a7a7a',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    margin: '8px 0 4px',
  },
  file: { fontSize: 12, color: '#7a7a7a' },
  row: { display: 'flex', gap: 8 },
  wrap: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  bar: { height: 4, background: '#222', marginTop: 6 },
  barFill: { height: 4, background: '#ff4a1c', transition: 'width .2s' },
  looks: { display: 'grid', gap: 6 },
  num: { fontFamily: 'ui-monospace, monospace', color: '#ff4a1c', marginRight: 6 },
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

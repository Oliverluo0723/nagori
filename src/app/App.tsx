import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Stage } from '../analysis/analyzeAudio';
import { bpmAt } from '../analysis/tempo';
import type { SourceKind } from '../analysis/types';
import { themes } from '../compose/themes';
import type { Composition } from '../compose/types';
import { looks } from '../looks/registry';
import type { Look } from '../looks/types';
import { createPreview, type Preview } from '../render/preview';
import { useProject } from './useProject';
import './App.css';

const PREVIEW_WIDTH = 540;

type LookGroupId = 'drums' | 'bass' | 'chords' | 'spectrum' | 'mix';

/** 依樂器分組。頻譜不是單一樂器，是整首混音的頻率能量。 */
const LOOK_GROUPS: { id: LookGroupId; name: string; note: string }[] = [
  { id: 'drums', name: '鼓', note: '跟著鼓點' },
  { id: 'bass', name: 'Bass', note: '跟著低音音高' },
  { id: 'chords', name: '和弦', note: '跟著和弦與調' },
  { id: 'spectrum', name: '整首頻譜', note: '跟著混音的頻率能量' },
  { id: 'mix', name: '綜合', note: '同時聽多種樂器' },
];

/** 主要驅動來源：listens 裡第一個不是 tempo/key 的；聽 4 種以上算綜合。 */
function lookGroup(lk: Look): LookGroupId {
  const kinds = lk.listens.filter((k) => k !== 'tempo' && k !== 'key');
  if (kinds.length >= 4) return 'mix';
  return (kinds[0] ?? 'chords') as LookGroupId;
}

const GROUPED_LOOKS = LOOK_GROUPS.map((g) => ({
  ...g,
  looks: Object.values(looks)
    .filter((lk) => lookGroup(lk) === g.id)
    .sort((a, b) => a.number - b.number),
})).filter((g) => g.looks.length > 0);

/** 鍵盤上下切換照分組後的順序走 */
const LOOK_LIST = GROUPED_LOOKS.flatMap((g) => g.looks);

function clock(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

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
  const [dragging, setDragging] = useState(false);
  const [now, setNow] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const previewRef = useRef<Preview | null>(null);

  const songTitle = state.status === 'ready' ? state.name : undefined;
  const composition = useMemo<Composition>(
    () => ({
      aspect: { w: 9, h: 16 },
      root: { kind: 'cell', id: 'c1', lookId, params: {} },
      themeId,
      title: songTitle,
    }),
    [themeId, lookId, songTitle],
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
    // preview 用 px 寫死顯示尺寸；改成填滿外框，讓 CSS 依視窗高度縮放
    const canvas = host.querySelector('canvas');
    if (canvas) {
      canvas.style.width = '100%';
      canvas.style.height = '100%';
    }
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

  const togglePlay = useCallback(async () => {
    const preview = previewRef.current;
    if (!preview || state.status !== 'ready') return;
    if (playing) {
      preview.pause();
      setPlaying(false);
    } else {
      await preview.play();
      setPlaying(true);
    }
  }, [playing, state.status]);

  const ready = state.status === 'ready' ? state : null;
  const tempo = ready?.readings.tempo;
  const bpm = tempo ? Math.round(bpmAt(tempo, 0) * 10) / 10 : 0;
  const offset = tempo?.offset ?? 0;
  const beat = bpm > 0 ? 60 / bpm : 0.5;
  const candidates = ready?.readings.rhythm?.candidates ?? [];

  // 播放時間：給播放列顯示
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const tick = () => setNow(audio.currentTime);
    audio.addEventListener('timeupdate', tick);
    audio.addEventListener('emptied', tick);
    return () => {
      audio.removeEventListener('timeupdate', tick);
      audio.removeEventListener('emptied', tick);
    };
  }, []);

  // 鍵盤：空白鍵播放／暫停，↑↓ 換 look
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        void togglePlay();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const i = LOOK_LIST.findIndex((lk) => lk.id === lookId);
        const n = LOOK_LIST.length;
        const next = LOOK_LIST[(i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n];
        setLookId(next.id);
        document.getElementById(`look-${next.id}`)?.scrollIntoView({ block: 'nearest' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, lookId]);

  const duration = ready?.readings.duration ?? 0;
  const pct = duration > 0 ? Math.min(100, (now / duration) * 100) : 0;
  const currentLook = looks[lookId];

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 整頁是拖放區，沒有鍵盤對應的操作
    <div
      className={`app${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.relatedTarget === null) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        drop(Array.from(e.dataTransfer.files));
      }}
    >
      <aside className="panel panel--left">
        <h1 className="logo">
          oto<span>.</span>
        </h1>

        <label className="drop">
          <strong>{ready ? '換一首歌' : '拖入音檔'}</strong>
          <span>或點這裡選檔・附 .mid 更準</span>
          <input
            type="file"
            multiple
            accept=".mp3,.wav,.aiff,.aif,.flac,.m4a,.ogg,.mid,.midi"
            onChange={(e) => {
              if (e.target.files) drop(Array.from(e.target.files));
              e.target.value = '';
            }}
          />
        </label>

        {state.status === 'analyzing' && (
          <div>
            <p className="status">
              分析中・{STAGE_TEXT[state.stage]} {Math.round(state.fraction * 100)}%
            </p>
            <div className="progress">
              <div style={{ width: `${Math.round(state.fraction * 100)}%` }} />
            </div>
          </div>
        )}
        {state.status === 'error' && <p className="error">{ERROR_TEXT[state.reason]}</p>}

        {ready && (
          <section>
            <p className="song-name">{ready.name}</p>
            <dl className="stats">
              <div>
                <dt>BPM</dt>
                <dd>{bpm}</dd>
              </div>
              <div>
                <dt>調</dt>
                <dd>{ready.readings.key?.name ?? '–'}</dd>
              </div>
              <div>
                <dt>長度</dt>
                <dd>{clock(ready.readings.duration)}</dd>
              </div>
              <div>
                <dt>鼓點</dt>
                <dd>{ready.readings.drums.length}</dd>
              </div>
              <div>
                <dt>和弦</dt>
                <dd>{ready.readings.chords?.length ?? 0}</dd>
              </div>
              <div>
                <dt>Bass</dt>
                <dd>{ready.readings.bass?.length ?? 0}</dd>
              </div>
            </dl>
            {ready.readings.drums.length === 0 && <p className="error">找不到鼓</p>}
            {ready.readings.source && (
              <p className="source">
                {Object.entries(ready.readings.source)
                  .map(([k, v]) => `${k}:${SOURCE_TEXT[v as SourceKind]}`)
                  .join('  ')}
              </p>
            )}
            {ready.notes.map((n) => (
              <p key={n} className="note">
                {n}
              </p>
            ))}
          </section>
        )}

        {ready && candidates.length > 0 && (
          <details className="tune">
            <summary>節拍校正</summary>
            <div>
              <div className="section-label">BPM 候選</div>
              <div className="chips">
                {candidates.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setTempo(c, offset)}
                    className={`chip${Math.abs(c - bpm) < 0.05 ? ' on' : ''}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="section-label">第一拍 {Math.round(offset * 1000)} ms</div>
              <div className="chips">
                {(
                  [
                    ['−1 拍', -beat],
                    ['−10ms', -0.01],
                    ['+10ms', 0.01],
                    ['+1 拍', beat],
                  ] as const
                ).map(([label, d]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setTempo(bpm, offset + d)}
                    className="chip"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </details>
        )}

        <p className="hint-keys">
          <kbd>空白</kbd> 播放 <kbd>↑</kbd>
          <kbd>↓</kbd> 換 look
        </p>
      </aside>

      <main className="stage">
        <div className="frame">
          <div ref={hostRef} className="canvas-host" />
        </div>
        <div className="transport">
          <button
            type="button"
            className="play"
            onClick={togglePlay}
            disabled={!ready}
            aria-label={playing ? '暫停' : '播放'}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <div className="transport-info">
            <div className="transport-title">
              <span>
                {ready ? ready.name : '還沒有歌'}
                {currentLook && (
                  <span className="look-count">
                    {'  '}· {String(currentLook.number).padStart(2, '0')} {currentLook.name}
                  </span>
                )}
              </span>
              <span>
                {clock(now)} / {clock(duration)}
              </span>
            </div>
            <div className="progress">
              <div style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
        {/* biome-ignore lint/a11y/useMediaCaption: 預覽用的音軌，無字幕 */}
        <audio ref={audioRef} />
      </main>

      <aside className="panel panel--right">
        <div className="right-head">
          <div>
            <div className="section-label">主題</div>
            <div className="segmented">
              {Object.values(themes).map((th) => (
                <button
                  key={th.id}
                  type="button"
                  onClick={() => setThemeId(th.id)}
                  className={th.id === themeId ? 'on' : ''}
                >
                  {th.name}
                </button>
              ))}
            </div>
          </div>
          <div className="section-label" style={{ margin: 0 }}>
            Looks <span className="look-count">{LOOK_LIST.length}</span>
          </div>
        </div>
        <div className="look-list">
          {GROUPED_LOOKS.map((g) => (
            <section key={g.id} className="look-group">
              <h3 className="look-group-head">
                {g.name} <span className="look-count">{g.looks.length}</span>
                <small>{g.note}</small>
              </h3>
              {g.looks.map((lk) => (
                <button
                  key={lk.id}
                  id={`look-${lk.id}`}
                  type="button"
                  onClick={() => setLookId(lk.id)}
                  className={`look${lk.id === lookId ? ' on' : ''}`}
                >
                  <span className="look-num">{String(lk.number).padStart(2, '0')}</span>
                  <span className="look-name">{lk.name}</span>
                </button>
              ))}
            </section>
          ))}
        </div>
      </aside>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Stage } from '../analysis/analyzeAudio';
import { bpmAt } from '../analysis/tempo';
import type { SourceKind } from '../analysis/types';
import {
  cellsOf,
  findCell,
  layoutTree,
  PRESETS,
  ratioAt,
  removeCell,
  setCellLook,
  setRatio,
  splitCell,
} from '../compose/layout';
import { contentBox, DEFAULT_CANVAS } from '../compose/render';
import { themes } from '../compose/themes';
import type { Composition, LayoutNode, Split } from '../compose/types';
import { looks } from '../looks/registry';
import type { Look } from '../looks/types';
import { exportVideo } from '../render/exportVideo';
import { createPreview, type Preview } from '../render/preview';
import { type ExportLength, exportRange } from '../render/range';
import { useProject } from './useProject';
import './App.css';

const PREVIEW_WIDTH = 540;
const PREVIEW_HEIGHT = Math.round((PREVIEW_WIDTH * 16) / 9);

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

const LENGTHS: { id: ExportLength; name: string }[] = [
  { id: 15, name: '15 秒' },
  { id: 30, name: '30 秒' },
  { id: 'full', name: '整首' },
];

type ExportState =
  | { status: 'idle' }
  | { status: 'running'; percent: number }
  | { status: 'done'; url: string; fileName: string }
  | { status: 'error'; message: string };

/** 檔名：歌名-look-起點，去掉檔案系統不收的字元。 */
function exportFileName(song: string, lookId: string, start: number): string {
  const safe = song.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'oto';
  return `${safe}-${lookId}-${clock(start).replace(':', 'm')}s.mp4`;
}

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
  const [root, setRoot] = useState<LayoutNode>(() => PRESETS[0].build());
  const [selectedId, setSelectedId] = useState('c1');
  const [framed, setFramed] = useState(true);
  const [signature, setSignature] = useState(DEFAULT_CANVAS.signature);
  const selectedCell = findCell(root, selectedId) ?? cellsOf(root)[0];
  const lookId = selectedCell.lookId;
  const setLookId = useCallback(
    (id: string) => setRoot((r) => setCellLook(r, selectedCell.id, id)),
    [selectedCell.id],
  );
  const [playing, setPlaying] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [now, setNow] = useState(0);
  const [exportLength, setExportLength] = useState<ExportLength>(15);
  const [snap, setSnap] = useState(true);
  const [exporting, setExporting] = useState<ExportState>({ status: 'idle' });
  const exportAbort = useRef<AbortController | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const previewRef = useRef<Preview | null>(null);

  const songTitle = state.status === 'ready' ? state.name : undefined;
  const composition = useMemo<Composition>(
    () => ({
      aspect: { w: 9, h: 16 },
      root,
      themeId,
      title: songTitle,
      canvas: framed ? { ...DEFAULT_CANVAS, signature } : undefined,
    }),
    [themeId, root, songTitle, framed, signature],
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

  const duration = ready?.readings.duration ?? 0;
  const pct = duration > 0 ? Math.min(100, (now / duration) * 100) : 0;
  const currentLook = looks[lookId];

  const range = useMemo(
    () =>
      tempo ? exportRange({ length: exportLength, playhead: now, snap, tempo, duration }) : null,
    [tempo, exportLength, now, snap, duration],
  );

  const seek = useCallback(
    (t: number) => {
      if (!ready) return;
      const clamped = Math.max(0, Math.min(duration, t));
      previewRef.current?.seek(clamped);
      setNow(clamped);
    },
    [ready, duration],
  );

  const scrubTo = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - box.left) / box.width) * duration);
  };

  // 換歌就收掉上一次的輸出
  // biome-ignore lint/correctness/useExhaustiveDependencies: audioUrl 是觸發條件，effect 本身不讀它
  useEffect(() => {
    exportAbort.current?.abort();
    setExporting((s) => {
      if (s.status === 'done') URL.revokeObjectURL(s.url);
      return { status: 'idle' };
    });
  }, [audioUrl]);

  const runExport = async () => {
    if (!ready || !range || exporting.status === 'running') return;
    previewRef.current?.pause();
    setPlaying(false);
    if (exporting.status === 'done') URL.revokeObjectURL(exporting.url);
    const ac = new AbortController();
    exportAbort.current = ac;
    setExporting({ status: 'running', percent: 0 });
    let shown = 0;
    try {
      const blob = await exportVideo({
        composition,
        readings: ready.readings,
        audioUrl: ready.audioUrl,
        range,
        signal: ac.signal,
        onProgress: (f) => {
          const percent = Math.floor(f * 100);
          if (percent !== shown) {
            shown = percent;
            setExporting({ status: 'running', percent });
          }
        },
      });
      if (ac.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const fileName = exportFileName(
        ready.name,
        root.kind === 'cell' ? lookId : 'reel',
        range.start,
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      setExporting({ status: 'done', url, fileName });
    } catch (err) {
      if (ac.signal.aborted) {
        setExporting({ status: 'idle' });
        return;
      }
      setExporting({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  // 拼版：預覽座標（540×960）下的格子與切線，蓋在畫布上給人點、拖
  const edit = useMemo(() => {
    const { box, gap } = contentBox(composition, PREVIEW_WIDTH, PREVIEW_HEIGHT);
    return { ...layoutTree(composition.root, box, gap), gap };
  }, [composition]);
  const multi = root.kind === 'split';
  const pctX = (v: number) => `${(v / PREVIEW_WIDTH) * 100}%`;
  const pctY = (v: number) => `${(v / PREVIEW_HEIGHT) * 100}%`;

  const split = (direction: Split['direction']) => {
    const r = splitCell(root, selectedCell.id, direction);
    setRoot(r.root);
    setSelectedId(r.newCellId);
  };
  const remove = () => {
    const next = removeCell(root, selectedCell.id);
    setRoot(next);
    setSelectedId(cellsOf(next)[0].id);
  };

  // 鍵盤：空白鍵播放／暫停，↑↓ 換 look，←→ 跳一小節
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        void togglePlay();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const bar = (60 / (bpm || 120)) * 4;
        seek(now + (e.key === 'ArrowRight' ? bar : -bar));
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
  }, [togglePlay, lookId, setLookId, seek, now, bpm]);

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

        <section className="compose">
          <div className="section-label">拼版</div>
          <div className="chips">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="chip"
                onClick={() => {
                  setRoot(p.build());
                  setSelectedId('c1');
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
          <p className="compose-sel">
            選中 <b>{selectedCell.id}</b>・{String(looks[lookId]?.number ?? 0).padStart(2, '0')}{' '}
            {looks[lookId]?.name}
          </p>
          <div className="chips">
            <button type="button" className="chip" onClick={() => split('row')}>
              ┃ 左右切
            </button>
            <button type="button" className="chip" onClick={() => split('column')}>
              ━ 上下切
            </button>
            <button type="button" className="chip" onClick={remove} disabled={!multi}>
              刪這格
            </button>
          </div>
          <label className="check">
            <input type="checkbox" checked={framed} onChange={(e) => setFramed(e.target.checked)} />
            安全區與底欄
          </label>
          {framed && (
            <label className="field">
              簽名
              <input value={signature} onChange={(e) => setSignature(e.target.value)} />
            </label>
          )}
        </section>

        {ready && range && (
          <section className="export">
            <div className="section-label">輸出 1080×1920</div>
            <div className="segmented">
              {LENGTHS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setExportLength(l.id)}
                  className={l.id === exportLength ? 'on' : ''}
                  disabled={exporting.status === 'running'}
                >
                  {l.name}
                </button>
              ))}
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={snap}
                onChange={(e) => setSnap(e.target.checked)}
                disabled={exportLength === 'full' || exporting.status === 'running'}
              />
              起點吸附小節
            </label>
            <p className="export-range">
              {clock(range.start)} – {clock(range.end)}
              <span>・從播放線起</span>
            </p>
            {exporting.status === 'running' ? (
              <div>
                <p className="status">
                  逐幀輸出中 {exporting.percent}%
                  <button
                    type="button"
                    className="link"
                    onClick={() => exportAbort.current?.abort()}
                  >
                    取消
                  </button>
                </p>
                <div className="progress">
                  <div style={{ width: `${exporting.percent}%` }} />
                </div>
              </div>
            ) : (
              <button type="button" className="export-go" onClick={runExport}>
                輸出 mp4
              </button>
            )}
            {exporting.status === 'done' && (
              <a className="note" href={exporting.url} download={exporting.fileName}>
                已下載 {exporting.fileName}
              </a>
            )}
            {exporting.status === 'error' && <p className="error">{exporting.message}</p>}
          </section>
        )}

        <p className="hint-keys">
          <kbd>空白</kbd> 播放 <kbd>↑</kbd>
          <kbd>↓</kbd> 換 look <kbd>←</kbd>
          <kbd>→</kbd> 跳一小節
        </p>
      </aside>

      <main className="stage">
        <div className="frame">
          <div className="canvas-host">
            <div ref={hostRef} className="canvas-mount" />
            <div className="overlay">
              {multi &&
                edit.cells.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-label={`選 ${c.id}`}
                    className={`cell-hit${c.id === selectedCell.id ? ' on' : ''}`}
                    style={{ left: pctX(c.x), top: pctY(c.y), width: pctX(c.w), height: pctY(c.h) }}
                    onClick={() => setSelectedId(c.id)}
                  />
                ))}
              {edit.dividers.map((d) => {
                const row = d.direction === 'row';
                const style = row
                  ? { left: pctX(d.box.x + d.at), top: pctY(d.box.y), height: pctY(d.box.h) }
                  : { top: pctY(d.box.y + d.at), left: pctX(d.box.x), width: pctX(d.box.w) };
                return (
                  <div
                    key={d.splitId}
                    className={`divider ${row ? 'divider--row' : 'divider--column'}`}
                    style={style}
                    onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
                    onPointerMove={(e) => {
                      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                      const host = e.currentTarget.parentElement?.getBoundingClientRect();
                      if (!host) return;
                      const pointer = {
                        x: ((e.clientX - host.left) / host.width) * PREVIEW_WIDTH,
                        y: ((e.clientY - host.top) / host.height) * PREVIEW_HEIGHT,
                      };
                      setRoot((r) => setRatio(r, d.splitId, ratioAt(d, pointer, edit.gap)));
                    }}
                  />
                );
              })}
            </div>
          </div>
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
            <div
              className={`scrub${ready ? '' : ' off'}`}
              role="slider"
              tabIndex={0}
              aria-label="播放位置"
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(now)}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                scrubTo(e);
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) scrubTo(e);
              }}
            >
              {range && duration > 0 && (
                <div
                  className="scrub-range"
                  style={{
                    left: `${(range.start / duration) * 100}%`,
                    width: `${((range.end - range.start) / duration) * 100}%`,
                  }}
                />
              )}
              <div className="scrub-fill" style={{ width: `${pct}%` }} />
              <div className="scrub-head" style={{ left: `${pct}%` }} />
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

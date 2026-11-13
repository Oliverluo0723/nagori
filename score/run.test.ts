// `pnpm score`：對有標準答案的歌算分數。
// 永遠會跑的合成案例有門檻（擋退步）；samples/score/*.json 的真歌只印表、不擋。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { expectedHits, synthBeat } from '../test/fixtures/audio';
import { analyzeAudio } from '../src/analysis/analyzeAudio';
import type { Stems } from '../src/analysis/stems/types';
import type { Readings } from '../src/analysis/types';
import { runAnalysis } from '../src/analysis/workerClient';
import {
  beatScore,
  gridScore,
  chordQualityAccuracy,
  chordRootAccuracy,
  drumF1,
  noteF1,
  pitchTimeAccuracy,
  type SongTruth,
  type TruthNote,
} from './metrics';
import { transcribeNode } from './transcribeNode';

const ROOT = join(import.meta.dirname, '..');
const TRUTH_DIR = join(ROOT, 'samples', 'score');
const REPORT = join(ROOT, 'score', 'last-run.md');
const SR = 44100;

interface Row {
  name: string;
  stems: boolean;
  bassPitch?: number;
  bassF1?: number;
  octaveErrors?: number;
  chordRoot?: number;
  chordQuality?: number;
  beatF1?: number;
  bpmRatio?: number;
  beatError?: number;
  onGrid?: number;
  gridError?: number;
  downbeat?: number;
  noteF1?: number;
  notePrecision?: number;
  noteRecall?: number;
  noteCount?: string;
  kick?: number;
  snare?: number;
  hat?: number;
}

const rows: Row[] = [];
const pct = (v?: number) => (v === undefined ? '–' : `${(v * 100).toFixed(0)}%`);

function score(name: string, r: Readings, truth: SongTruth, stems: boolean): Row {
  const row: Row = { name, stems };
  if (truth.bass) {
    const f = noteF1(r.bass ?? [], truth.bass);
    row.bassPitch = pitchTimeAccuracy(r.bass ?? [], truth.bass);
    row.bassF1 = f.f1;
    row.octaveErrors = f.octaveErrors;
  }
  if (truth.chords) {
    row.chordRoot = chordRootAccuracy(r.chords ?? [], truth.chords);
    row.chordQuality = chordQualityAccuracy(r.chords ?? [], truth.chords);
  }
  if (truth.beats && r.rhythm) {
    const b = beatScore(r.rhythm.beats, r.rhythm.bpm, truth.beats, truth.bpm ?? 0);
    row.beatF1 = b.f1;
    row.bpmRatio = b.bpmRatio;
    row.beatError = b.meanAbsError;
    const g = gridScore(r.tempo, truth.beats, truth.downbeats ?? []);
    row.onGrid = g.onGrid;
    row.gridError = g.meanAbsError;
    row.downbeat = truth.downbeats ? g.downbeat : undefined;
  }
  if (truth.notes) {
    const f = noteF1(r.notes ?? [], truth.notes);
    row.noteF1 = f.f1;
    row.notePrecision = f.precision;
    row.noteRecall = f.recall;
    row.noteCount = `${r.notes?.length ?? 0}/${truth.notes.length}`;
  }
  if (truth.drums) Object.assign(row, drumF1(r.drums, truth.drums));
  rows.push(row);
  return row;
}

function decode(path: string): Float32Array {
  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', path, '-ac', '1', '-ar', String(SR), '-f', 'f32le', 'pipe:1'],
    { maxBuffer: 1 << 30 },
  );
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

function loadStems(dir: string, length: number): Stems | undefined {
  const names = ['bass', 'drums', 'other', 'vocals'] as const;
  const files = names.map((n) => join(dir, `${n}.wav`));
  if (!files.slice(0, 3).every(existsSync)) return undefined;
  const fit = (a: Float32Array) => {
    const out = new Float32Array(length);
    out.set(a.subarray(0, length));
    return out;
  };
  const [bass, drums, other] = files.slice(0, 3).map((f) => fit(decode(f)));
  const vocals = existsSync(files[3]) ? fit(decode(files[3])) : new Float32Array(length);
  return { sampleRate: 44100, bass, drums, other, vocals };
}

function writeReport() {
  const lines = [
    `# score — ${new Date().toISOString()}`,
    '',
    '| 歌 | 分軌 | 拍 F1 | bpm 比 | 拍誤差 | 拍格 | 格誤差 | 強拍 | 音符 F1 | 音符 P/R | 顆數 預測/真 | 和弦根音 | 和弦品質 | bass 音高時間 | bass F1 | 八度錯 | kick | snare | hat |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.name} | ${r.stems ? '有' : '無'} | ${pct(r.beatF1)} | ${r.bpmRatio === undefined ? '–' : r.bpmRatio.toFixed(3)} | ${r.beatError === undefined ? '–' : `${(r.beatError * 1000).toFixed(0)} ms`} | ${pct(r.onGrid)} | ${r.gridError === undefined ? '–' : `${(r.gridError * 1000).toFixed(0)} ms`} | ${pct(r.downbeat)} | ${pct(r.noteF1)} | ${pct(r.notePrecision)}/${pct(r.noteRecall)} | ${r.noteCount ?? '–'} | ${pct(r.chordRoot)} | ${pct(r.chordQuality)} | ${pct(r.bassPitch)} | ${pct(r.bassF1)} | ${r.octaveErrors ?? '–'} | ${pct(r.kick)} | ${pct(r.snare)} | ${pct(r.hat)} |`,
    ),
  ];
  mkdirSync(join(ROOT, 'score'), { recursive: true });
  writeFileSync(REPORT, `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
}

test('synthetic beat (always runs; gate against regressions)', async () => {
  const bars = 8;
  const beat = 0.5;
  const pcm = synthBeat({ bars });
  const bassPattern = [35, 31, 38, 33];
  const bass: TruthNote[] = [];
  for (let bar = 0; bar < bars; bar++)
    for (let b = 0; b < 4; b++)
      bass.push({ time: (bar * 4 + b) * beat, duration: beat, midi: bassPattern[bar % 4] });
  const truth: SongTruth = {
    name: 'synthetic',
    audio: '',
    bass,
    drums: expectedHits({ bars }).map((h) => ({ time: h.time, kind: h.kind })),
  };
  const row = score('synthetic', await analyzeAudio(pcm, SR), truth, false);
  // 2026-11-12 實測：bass 音高時間 84%、kick F1 見 last-run.md；門檻留約 5% 餘裕，退步就紅
  expect(row.bassPitch ?? 0).toBeGreaterThanOrEqual(0.8);
  expect(row.kick ?? 0).toBeGreaterThanOrEqual(0.9);
});

const truthFiles = existsSync(TRUTH_DIR)
  ? readdirSync(TRUTH_DIR).filter((f) => f.endsWith('.json'))
  : [];

test.each(truthFiles)('%s', async (file) => {
  const truth = JSON.parse(readFileSync(join(TRUTH_DIR, file), 'utf8')) as SongTruth;
  const pcm = decode(join(ROOT, truth.audio));
  const stems = truth.stems ? loadStems(join(ROOT, truth.stems), pcm.length) : undefined;
  const { readings } = await runAnalysis(
    { pcm, sampleRate: SR, left: pcm, right: pcm, stems, separate: false },
    () => {},
    undefined,
    undefined,
    { transcribe: transcribeNode },
  );
  score(truth.name, readings, truth, stems !== undefined);
});

test('report', () => {
  if (truthFiles.length === 0) console.log('沒有評測集：samples/score/ 裡沒有 .json（見 score/README.md）');
  writeReport();
});

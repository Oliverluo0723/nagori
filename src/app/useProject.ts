import { useCallback, useState } from 'react';
import { analyzeMidi } from '../analysis/analyze';
import type { Readings } from '../analysis/types';

const AUDIO_EXT = ['mp3', 'wav', 'aiff', 'aif', 'flac', 'm4a', 'ogg'];
const MIDI_EXT = ['mid', 'midi'];

export type LoadResult =
  | { ok: true; readings: Readings; audioUrl: string; name: string }
  | { ok: false; reason: 'need-midi' | 'need-audio' | 'parse-failed' };

export interface LoadDeps {
  getDuration: (audio: File) => Promise<number>;
  createUrl?: (audio: File) => string;
}

function ext(file: File): string {
  const i = file.name.lastIndexOf('.');
  return i < 0 ? '' : file.name.slice(i + 1).toLowerCase();
}

/** 拖進來的檔案分流：找音檔與 .mid，分析後回傳 Readings。 */
export async function loadDroppedFiles(files: File[], deps: LoadDeps): Promise<LoadResult> {
  const audio = files.find((f) => AUDIO_EXT.includes(ext(f)));
  const midi = files.find((f) => MIDI_EXT.includes(ext(f)));
  if (!audio) return { ok: false, reason: 'need-audio' };
  if (!midi) return { ok: false, reason: 'need-midi' };
  try {
    const duration = await deps.getDuration(audio);
    const readings = analyzeMidi(await midi.arrayBuffer(), duration);
    const createUrl = deps.createUrl ?? ((f: File) => URL.createObjectURL(f));
    return {
      ok: true,
      readings,
      audioUrl: createUrl(audio),
      name: audio.name.replace(/\.[^.]+$/, ''),
    };
  } catch {
    return { ok: false, reason: 'parse-failed' };
  }
}

/** 用 <audio> 的 loadedmetadata 讀長度。 */
export function audioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = new Audio();
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(el.duration);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('cannot read audio'));
    };
    el.src = url;
  });
}

export type ProjectState =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'error'; reason: 'need-midi' | 'need-audio' | 'parse-failed' }
  | { status: 'ready'; readings: Readings; audioUrl: string; name: string };

export function useProject() {
  const [state, setState] = useState<ProjectState>({ status: 'empty' });

  const drop = useCallback(async (files: File[]) => {
    setState({ status: 'loading' });
    const r = await loadDroppedFiles(files, { getDuration: audioDuration });
    if (r.ok)
      setState({ status: 'ready', readings: r.readings, audioUrl: r.audioUrl, name: r.name });
    else setState({ status: 'error', reason: r.reason });
  }, []);

  return { state, drop };
}

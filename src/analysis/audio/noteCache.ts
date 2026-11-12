import type { NoteEvent } from '../types';

/** 轉譜結果的快取：同一份音訊（同 key）第二次不再跑 Basic Pitch。介面仿 StemStore */
export interface NoteStore {
  get(key: string): Promise<NoteEvent[] | undefined>;
  put(key: string, notes: NoteEvent[]): Promise<void>;
}

/** 前綴 v1：以後換模型或改後處理就換前綴，整批舊快取自然失效 */
const KEY_VERSION = 'notes-v1';

/** 餵進轉譜器那份 PCM 的 SHA-256 ＋ 門檻後綴 */
export async function noteKey(pcm: Float32Array, thresholds: string): Promise<string> {
  const view = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  // crypto.subtle 不收 SharedArrayBuffer 上的 view：那種就複製一份
  const bytes =
    pcm.buffer instanceof ArrayBuffer ? (view as Uint8Array<ArrayBuffer>) : new Uint8Array(view);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${KEY_VERSION}-${hex}-${thresholds}`;
}

/** 音符存成扁平數字陣列 [time, duration, midi, velocity, …]，JSON 比物件陣列小一半 */
export function packNotes(notes: readonly NoteEvent[]): string {
  const flat: number[] = [];
  for (const n of notes) flat.push(n.time, n.duration, n.midi, n.velocity);
  return JSON.stringify({ v: 1, flat });
}

export function unpackNotes(text: string): NoteEvent[] | undefined {
  try {
    const data = JSON.parse(text) as { v?: number; flat?: unknown };
    if (data.v !== 1 || !Array.isArray(data.flat) || data.flat.length % 4 !== 0) return undefined;
    const f = data.flat as unknown[];
    if (!f.every((x) => typeof x === 'number' && Number.isFinite(x))) return undefined;
    const out: NoteEvent[] = [];
    for (let i = 0; i < f.length; i += 4)
      out.push({
        time: f[i] as number,
        duration: f[i + 1] as number,
        midi: f[i + 2] as number,
        velocity: f[i + 3] as number,
      });
    return out;
  } catch {
    return undefined;
  }
}

export class MemoryNoteStore implements NoteStore {
  private map = new Map<string, string>();
  async get(key: string): Promise<NoteEvent[] | undefined> {
    const hit = this.map.get(key);
    return hit === undefined ? undefined : unpackNotes(hit);
  }
  async put(key: string, notes: NoteEvent[]): Promise<void> {
    this.map.set(key, packNotes(notes));
  }
}

/** OPFS：目錄 notes/ 底下每首一個 .json。讀不到或格式不對就當 miss（下次重算會覆蓋） */
export class OpfsNoteStore implements NoteStore {
  private dir: Promise<FileSystemDirectoryHandle> | undefined;

  private root(): Promise<FileSystemDirectoryHandle> {
    this.dir ??= navigator.storage
      .getDirectory()
      .then((r) => r.getDirectoryHandle('notes', { create: true }));
    return this.dir;
  }

  async get(key: string): Promise<NoteEvent[] | undefined> {
    try {
      const dir = await this.root();
      return unpackNotes(await (await (await dir.getFileHandle(`${key}.json`)).getFile()).text());
    } catch {
      return undefined;
    }
  }

  async put(key: string, notes: NoteEvent[]): Promise<void> {
    const dir = await this.root();
    const handle = await dir.getFileHandle(`${key}.json`, { create: true });
    const w = await handle.createWritable();
    await w.write(packNotes(notes));
    await w.close();
  }
}

/** 這個環境有沒有 OPFS（Node 測試沒有） */
export function opfsAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
}

import { assertStems, STEM_NAMES, type Stems } from './types';

/** 分軌結果的快取：同一首歌（同 bytes）第二次不再跑 Demucs */
export interface StemStore {
  get(key: string): Promise<Stems | undefined>;
  put(key: string, stems: Stems): Promise<void>;
}

/** 前綴 v1：以後換模型就換前綴，整批舊快取自然失效 */
const KEY_VERSION = 'v1';

/** 音檔 bytes 的 SHA-256（crypto.subtle，瀏覽器與 Node 20+ 都有） */
export async function stemKey(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${KEY_VERSION}-${hex}`;
}

export class MemoryStemStore implements StemStore {
  private map = new Map<string, Stems>();
  async get(key: string): Promise<Stems | undefined> {
    return this.map.get(key);
  }
  async put(key: string, stems: Stems): Promise<void> {
    this.map.set(key, stems);
  }
}

/**
 * OPFS：目錄 stems/ 底下每軌一個 .f32 檔，另一個 .json 記長度。
 * 任何一軌缺或長度不合就當 miss（下次重算會覆蓋）。
 */
export class OpfsStemStore implements StemStore {
  private dir: Promise<FileSystemDirectoryHandle> | undefined;

  private root(): Promise<FileSystemDirectoryHandle> {
    this.dir ??= navigator.storage
      .getDirectory()
      .then((r) => r.getDirectoryHandle('stems', { create: true }));
    return this.dir;
  }

  async get(key: string): Promise<Stems | undefined> {
    try {
      const dir = await this.root();
      const meta = JSON.parse(
        await (await (await dir.getFileHandle(`${key}.json`)).getFile()).text(),
      ) as { length: number };
      const read = async (name: string) => {
        const file = await (await dir.getFileHandle(`${key}.${name}.f32`)).getFile();
        const buf = await file.arrayBuffer();
        if (buf.byteLength !== meta.length * 4) throw new Error('stem cache: length mismatch');
        return new Float32Array(buf);
      };
      const stems: Stems = {
        sampleRate: 44100,
        drums: await read('drums'),
        bass: await read('bass'),
        other: await read('other'),
        vocals: await read('vocals'),
      };
      assertStems(stems);
      return stems;
    } catch {
      return undefined;
    }
  }

  async put(key: string, stems: Stems): Promise<void> {
    const dir = await this.root();
    const write = async (name: string, data: BufferSource | string) => {
      const handle = await dir.getFileHandle(name, { create: true });
      const w = await handle.createWritable();
      await w.write(data);
      await w.close();
    };
    // 複製一份：Float32Array 可能坐在 SharedArrayBuffer 上，OPFS 的 write 只收 ArrayBuffer
    for (const name of STEM_NAMES)
      await write(`${key}.${name}.f32`, Float32Array.from(stems[name]));
    await write(`${key}.json`, JSON.stringify({ length: stems.drums.length }));
  }
}

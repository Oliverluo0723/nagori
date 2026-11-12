/** 使用者丟進來的 mp4。檔案留在記憶體，版型只記 clipId。 */
export interface Clip {
  id: string;
  name: string;
  file: File;
  url: string;
  /** 顯示尺寸（已套用旋轉） */
  w: number;
  h: number;
  duration: number;
}

const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm'];

export function isVideoFile(file: File): boolean {
  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  return file.type.startsWith('video/') || VIDEO_EXT.includes(ext);
}

let seq = 0;

/** 讀影片的尺寸與長度；Chrome 播不了就 reject。 */
export function loadClip(file: File): Promise<Clip> {
  const url = URL.createObjectURL(file);
  const el = document.createElement('video');
  el.muted = true;
  el.preload = 'metadata';
  return new Promise<Clip>((resolve, reject) => {
    el.onloadedmetadata = () => {
      if (!el.videoWidth || !el.videoHeight) {
        reject(new Error('no video track'));
        return;
      }
      seq += 1;
      resolve({
        id: `v${seq}`,
        name: file.name,
        file,
        url,
        w: el.videoWidth,
        h: el.videoHeight,
        duration: el.duration,
      });
    };
    el.onerror = () => reject(new Error('cannot decode'));
    el.src = url;
  }).catch((err) => {
    URL.revokeObjectURL(url);
    throw err;
  });
}

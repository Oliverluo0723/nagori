import type { Header } from '@tonejs/midi';
import { pcFromName, pcName } from '../../looks/music';
import type { ChordEvent, KeyInfo } from '../types';

function info(tonic: number, mode: 'major' | 'minor'): KeyInfo {
  return { tonic, mode, name: `${pcName(tonic)} ${mode}` };
}

/** header 的 keySignature 優先；沒有就看和弦根音最多的 pitch class，模式看它的和弦大調多還是小調多。 */
export function detectKey(header: Header, chords: ChordEvent[]): KeyInfo | undefined {
  const sig = header.keySignatures[0];
  // 某些檔（或 @tonejs/midi 自己寫的檔）解析出來 key 會是 undefined，退回和弦統計
  if (sig?.key) {
    // @tonejs/midi 只依升降號數量給「關係大調」的名稱：小調要往下三個半音（+9）才是主音
    const major = pcFromName(sig.key);
    if (major >= 0) {
      return sig.scale === 'minor' ? info((major + 9) % 12, 'minor') : info(major, 'major');
    }
  }
  if (chords.length === 0) return undefined;
  const count = new Array<number>(12).fill(0);
  for (const c of chords) count[c.root]++;
  let tonic = 0;
  for (let pc = 1; pc < 12; pc++) if (count[pc] > count[tonic]) tonic = pc;
  let minor = 0;
  let major = 0;
  for (const c of chords) {
    if (c.root !== tonic) continue;
    if (/m(?!aj)/.test(c.name.replace(/^[A-G][♯♭#b]?/, ''))) minor++;
    else major++;
  }
  return info(tonic, minor > major ? 'minor' : 'major');
}

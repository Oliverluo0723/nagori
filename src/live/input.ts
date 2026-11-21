import { KEY_MAP, type LiveKey } from './keys';

/** 鍵盤事件裡判斷需要的部分（App 從 KeyboardEvent 抄過來，測試直接給） */
export interface KeyInput {
  code: string;
  repeat: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  /** 事件目標的 tagName */
  target: string;
  /** 目標是 INPUT 時的 type */
  type?: string;
}

/** 不需要打字的 input：焦點停在這些上面（點過勾選框、取消檔案選擇）照樣能彈 */
const NON_TEXT_INPUTS = new Set([
  'checkbox',
  'radio',
  'file',
  'button',
  'submit',
  'reset',
  'range',
  'color',
  'image',
]);

/** 回傳要處理的鍵；不該處理（重複、組合鍵、在打字的欄位裡、不在鍵位表）回 null。 */
export function liveKeyFor(e: KeyInput): LiveKey | null {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.target === 'TEXTAREA' || e.target === 'SELECT') return null;
  if (e.target === 'INPUT' && !NON_TEXT_INPUTS.has(e.type ?? 'text')) return null;
  return KEY_MAP[e.code] ?? null;
}

/** 放開這個鍵時要放開所有音：macOS 按著 Cmd 時，其他鍵的 keyup 不會送來。 */
export function releasesAll(key: string): boolean {
  return key === 'Meta';
}

import { expect, test } from 'vitest';
import { type KeyInput, liveKeyFor, releasesAll } from './input';

const k = (over: Partial<KeyInput> = {}): KeyInput => ({
  code: 'KeyA',
  repeat: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  target: 'BODY',
  ...over,
});

test('A 是 C4（只看 code，輸入法不影響）', () => {
  expect(liveKeyFor(k())).toEqual({ kind: 'note', midi: 60 });
});

test('按住不放的重複事件不處理', () => {
  expect(liveKeyFor(k({ repeat: true }))).toBeNull();
});

test('Cmd+C、Ctrl+R、Alt 組合不處理', () => {
  expect(liveKeyFor(k({ code: 'KeyC', metaKey: true }))).toBeNull();
  expect(liveKeyFor(k({ code: 'KeyA', ctrlKey: true }))).toBeNull();
  expect(liveKeyFor(k({ altKey: true }))).toBeNull();
});

test('在輸入框裡打字不處理', () => {
  expect(liveKeyFor(k({ target: 'INPUT' }))).toBeNull();
  expect(liveKeyFor(k({ target: 'TEXTAREA' }))).toBeNull();
});

test('不在鍵位表的鍵不處理', () => {
  expect(liveKeyFor(k({ code: 'KeyQ' }))).toBeNull();
});

test('焦點在勾選框或檔案選擇上時照樣彈（只有打字的欄位才不處理）', () => {
  expect(liveKeyFor(k({ target: 'INPUT', type: 'checkbox' }))).toEqual({ kind: 'note', midi: 60 });
  expect(liveKeyFor(k({ target: 'INPUT', type: 'file' }))).toEqual({ kind: 'note', midi: 60 });
  expect(liveKeyFor(k({ target: 'INPUT', type: 'text' }))).toBeNull();
  expect(liveKeyFor(k({ target: 'INPUT', type: 'number' }))).toBeNull();
});

test('放開 Cmd 時全部放開（macOS 按著 Cmd 時收不到其他鍵的 keyup）', () => {
  expect(releasesAll('Meta')).toBe(true);
  expect(releasesAll('a')).toBe(false);
});

import { expect, test } from 'vitest';
import { clipRunning, clipTime, coverCrop, dragAlign } from './video';

test('clipTime pins the clip to song time and freezes at both ends', () => {
  const layer = { start: 10 };
  expect(clipTime(12.5, layer, 8)).toBe(2.5);
  expect(clipTime(3, layer, 8)).toBe(0);
  expect(clipTime(30, layer, 8)).toBeCloseTo(8, 2);
  expect(clipTime(30, layer, 8)).toBeLessThan(8);
  expect(clipRunning(12, layer, 8)).toBe(true);
  expect(clipRunning(9, layer, 8)).toBe(false);
  expect(clipRunning(19, layer, 8)).toBe(false);
});

test('coverCrop fills the target without distortion, centered by default', () => {
  // 16:9 影片放進 9:16 格：只取中間一條
  const c = coverCrop({ w: 1920, h: 1080 }, { w: 540, h: 960 }, 0.5, 0.5);
  expect(c.h).toBeCloseTo(1080);
  expect(c.w / c.h).toBeCloseTo(540 / 960);
  expect(c.x).toBeCloseTo((1920 - c.w) / 2);
  expect(c.y).toBe(0);
  expect(coverCrop({ w: 1920, h: 1080 }, { w: 540, h: 960 }, 0, 0.5).x).toBe(0);
  // 鏡像：畫面上的左邊來自來源的右邊
  const m = coverCrop({ w: 1920, h: 1080 }, { w: 540, h: 960 }, 0, 0.5, true);
  expect(m.x + m.w).toBeCloseTo(1920);
});

test('dragAlign moves the image with the pointer and clamps', () => {
  const src = { w: 1920, h: 1080 };
  const dst = { w: 540, h: 960 };
  const right = dragAlign(src, dst, { x: 0.5, y: 0.5 }, 100, 0);
  expect(right.x).toBeLessThan(0.5);
  expect(right.y).toBe(0.5); // 垂直沒有多出來的，不動
  expect(dragAlign(src, dst, { x: 0.5, y: 0.5 }, -99999, 0).x).toBe(1);
});

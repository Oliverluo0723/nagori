import { expect, test } from 'vitest';
import { makeCtx } from '../../test/fixtures/looks';
import { cellsOf, PRESETS, setCellLook } from '../compose/layout';
import { RecordingPainter } from '../looks/painter/recording';
import { looks } from '../looks/registry';
import { isLiveLook, LIVE_LOOK_IDS, liveLayout } from './looks';
import { type LiveEvent, liveReadings } from './readings';

const lookIds = (id: string) => {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(id);
  return cellsOf(liveLayout(preset.build())).map((c) => c.lookId);
};

test('上下兩格換成鋼琴捲和鼓格', () => {
  expect(lookIds('stack')).toEqual(['roll', 'grid']);
});

test('四格依序分配', () => {
  expect(lookIds('quad')).toEqual(['roll', 'grid', 'groove', 'stars']);
});

test('已經是即時 look 的格子不動', () => {
  const root = setCellLook(PRESETS[0].build(), 'c1', 'wheel');
  expect(liveLayout(root)).toBe(root);
});

test('isLiveLook', () => {
  expect(isLiveLook('roll')).toBe(true);
  expect(isLiveLook('strata')).toBe(false);
});

// 每個 look × 三種讀數都畫得出來
const CASES: [string, LiveEvent[], number][] = [
  ['還沒按鍵', [], 0],
  [
    '只有鼓',
    [
      { type: 'drum', drum: 'kick', time: 0.5 },
      { type: 'drum', drum: 'hat', time: 1 },
    ],
    2,
  ],
  ['按著一個和弦', [60, 64, 67].map((midi) => ({ type: 'on' as const, midi, time: 1 })), 2.5],
];
for (const id of LIVE_LOOK_IDS) {
  for (const [name, events, now] of CASES) {
    test(`${id}：${name} 畫得出來`, () => {
      const p = new RecordingPainter();
      looks[id].draw(p, makeCtx(now, liveReadings(events, now), { w: 540, h: 480 }));
      expect(p.ops.length).toBeGreaterThan(0);
    });
  }
}

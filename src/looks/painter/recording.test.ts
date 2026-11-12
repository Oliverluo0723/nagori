import { expect, test } from 'vitest';
import { RecordingPainter } from './recording';

test('RecordingPainter records every call in order with args', () => {
  const p = new RecordingPainter();
  p.fill('#fff');
  p.circle(1, 2, 3);
  expect(p.ops).toEqual([
    { op: 'fill', args: ['#fff', undefined] },
    { op: 'circle', args: [1, 2, 3] },
  ]);
});

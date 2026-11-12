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

test('RecordingPainter records wedge, polyline and ellipse with raw args', () => {
  const p = new RecordingPainter();
  p.wedge(10, 20, 5, 9, 0, Math.PI / 2);
  p.polyline([
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ]);
  p.ellipse(3, 4, 5, 6);
  expect(p.ops).toEqual([
    { op: 'wedge', args: [10, 20, 5, 9, 0, Math.PI / 2] },
    {
      op: 'polyline',
      args: [
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      ],
    },
    { op: 'ellipse', args: [3, 4, 5, 6] },
  ]);
});

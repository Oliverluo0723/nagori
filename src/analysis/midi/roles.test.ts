import { expect, test } from 'vitest';
import { assignRoles } from './roles';

test('names map to roles, channel 9 is drums regardless of name', () => {
  expect(
    assignRoles([
      { index: 0, name: 'Drums', channel: 0 },
      { index: 1, name: '808 Bass', channel: 1 },
      { index: 2, name: 'Pad chords', channel: 2 },
      { index: 3, name: '鼓', channel: 9 },
      { index: 4, name: '', channel: 3 },
    ]).map((r) => r.role),
  ).toEqual(['drums', 'bass', 'chords', 'drums', 'other']);
});

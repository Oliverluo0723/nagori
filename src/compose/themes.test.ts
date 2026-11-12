import { expect, test } from 'vitest';
import { darkGlow, paperInk, themes } from './themes';

test("both themes define 12 note colours and the spec'd core colours", () => {
  for (const th of [darkGlow, paperInk]) expect(th.noteColors).toHaveLength(12);
  expect(darkGlow).toMatchObject({
    paper: '#0f0f0f',
    ink: '#efece4',
    mute: '#7a7a7a',
    line: '#2a2a2a',
    accent: '#ff4a1c',
    glow: true,
  });
  expect(paperInk).toMatchObject({
    paper: '#f1ede4',
    ink: '#161616',
    mute: '#6b665c',
    line: '#c9c3b6',
    accent: '#ff4a1c',
    glow: false,
  });
  expect(themes[darkGlow.id]).toBe(darkGlow);
  expect(themes[paperInk.id]).toBe(paperInk);
});

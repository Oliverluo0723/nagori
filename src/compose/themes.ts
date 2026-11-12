import type { Theme } from './types';

// 12 色依 C、C♯、D、D♯、E、F、F♯、G、G♯、A、A♯、B 順序。
// 黑底：飽和偏亮；紙感：同色相降飽和降明度，在 #f1ede4 上看得清。

export const darkGlow: Theme = {
  id: 'darkGlow',
  name: '黑底發光',
  paper: '#0f0f0f',
  ink: '#efece4',
  mute: '#7a7a7a',
  line: '#2a2a2a',
  accent: '#ff4a1c',
  noteColors: [
    '#ff6b4a', // C
    '#ff8a5c', // C♯
    '#ffa94d', // D
    '#f3c54a', // D♯
    '#f3b23e', // E
    '#c8d96a', // F
    '#9ad98a', // F♯
    '#8dd3c7', // G
    '#6fc3e0', // G♯
    '#4f7cff', // A
    '#8c6cff', // A♯
    '#d66cff', // B
  ],
  glow: true,
};

export const paperInk: Theme = {
  id: 'paperInk',
  name: '紙感墨印',
  paper: '#f1ede4',
  ink: '#161616',
  mute: '#6b665c',
  line: '#c9c3b6',
  accent: '#ff4a1c',
  noteColors: [
    '#b8402a', // C
    '#b85536', // C♯
    '#b06a2a', // D
    '#a5812a', // D♯
    '#9a7a24', // E
    '#7c8a2c', // F
    '#4f8a4a', // F♯
    '#3f8a7c', // G
    '#3a7e95', // G♯
    '#3a56b0', // A
    '#5e48a8', // A♯
    '#8a3f9a', // B
  ],
  glow: false,
};

export const themes: Record<string, Theme> = {
  [darkGlow.id]: darkGlow,
  [paperInk.id]: paperInk,
};

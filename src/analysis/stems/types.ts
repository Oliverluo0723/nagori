export const STEM_NAMES = ['drums', 'bass', 'other', 'vocals'] as const;
export type StemName = (typeof STEM_NAMES)[number];

/** Demucs 分出來的四軌：各自單聲道、同長度、44 100 Hz */
export interface Stems {
  sampleRate: 44100;
  drums: Float32Array;
  bass: Float32Array;
  other: Float32Array;
  vocals: Float32Array;
}

/** 長度不一致或 sampleRate 不是 44 100 就丟錯 */
export function assertStems(s: Stems): void {
  if (s.sampleRate !== 44100)
    throw new Error(`stems: sampleRate must be 44100, got ${s.sampleRate}`);
  const len = s[STEM_NAMES[0]].length;
  for (const name of STEM_NAMES) {
    if (s[name].length !== len)
      throw new Error(`stems: ${name} length ${s[name].length} differs from ${len}`);
  }
}

/** 幾軌逐樣本相加，不正規化（給和弦吃 other + bass 用） */
export function mixStems(s: Stems, names: StemName[]): Float32Array {
  const out = new Float32Array(s[STEM_NAMES[0]].length);
  for (const name of names) {
    const ch = s[name];
    for (let i = 0; i < out.length; i++) out[i] += ch[i];
  }
  return out;
}

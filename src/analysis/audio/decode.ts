export const ANALYSIS_SAMPLE_RATE = 44100;

export interface DecodedAudio {
  /** 單聲道混音（左右平均），分析用 */
  pcm: Float32Array;
  sampleRate: typeof ANALYSIS_SAMPLE_RATE;
  /** 左右聲道，給分軌用；來源是單聲道時兩條是同一個陣列 */
  left: Float32Array;
  right: Float32Array;
}

/**
 * 瀏覽器用：解碼音檔，重採樣到 44 100 Hz（essentia 的預設），回傳單聲道混音與左右聲道。
 * Node 測試不碰這個檔案。
 */
export async function decodeAudio(file: File): Promise<DecodedAudio> {
  const ctx = new AudioContext();
  let buffer: AudioBuffer;
  try {
    buffer = await ctx.decodeAudioData(await file.arrayBuffer());
  } finally {
    await ctx.close();
  }
  const length = Math.ceil(buffer.duration * ANALYSIS_SAMPLE_RATE);
  const channels = Math.min(2, buffer.numberOfChannels);
  const offline = new OfflineAudioContext(channels, length, ANALYSIS_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  const left = rendered.getChannelData(0);
  if (channels === 1) return { pcm: left, sampleRate: ANALYSIS_SAMPLE_RATE, left, right: left };
  const right = rendered.getChannelData(1);
  const pcm = new Float32Array(length);
  for (let i = 0; i < length; i++) pcm[i] = (left[i] + right[i]) / 2;
  return { pcm, sampleRate: ANALYSIS_SAMPLE_RATE, left, right };
}

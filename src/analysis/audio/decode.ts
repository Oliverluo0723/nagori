export const ANALYSIS_SAMPLE_RATE = 44100;

/**
 * 瀏覽器用：解碼音檔，混成單聲道，重採樣到 44 100 Hz（essentia 的預設）。
 * Node 測試不碰這個檔案。
 */
export async function decodeAudio(
  file: File,
): Promise<{ pcm: Float32Array; sampleRate: typeof ANALYSIS_SAMPLE_RATE }> {
  const ctx = new AudioContext();
  let buffer: AudioBuffer;
  try {
    buffer = await ctx.decodeAudioData(await file.arrayBuffer());
  } finally {
    await ctx.close();
  }
  const length = Math.ceil(buffer.duration * ANALYSIS_SAMPLE_RATE);
  const offline = new OfflineAudioContext(1, length, ANALYSIS_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  return { pcm: rendered.getChannelData(0), sampleRate: ANALYSIS_SAMPLE_RATE };
}

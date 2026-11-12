/** 瀏覽器用：解碼音檔並混成單聲道。Node 測試不碰這個檔案。 */
export async function decodeAudio(file: File): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const ctx = new AudioContext();
  try {
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    const channels = buffer.numberOfChannels;
    const pcm = new Float32Array(buffer.length);
    for (let c = 0; c < channels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) pcm[i] += data[i] / channels;
    }
    return { pcm, sampleRate: buffer.sampleRate };
  } finally {
    await ctx.close();
  }
}

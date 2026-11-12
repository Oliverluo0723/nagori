/// <reference lib="webworker" />
import { runAnalysis, type WorkerMessage, type WorkerRequest } from './workerClient';

// module Worker：收一首歌的 PCM，分軌（可選）＋分析，進度與結果都用訊息送回主執行緒
const post = (m: WorkerMessage) => self.postMessage(m);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, input } = e.data;
  try {
    const { readings, separationError } = await runAnalysis(
      input,
      (stage, fraction) => post({ id, type: 'progress', stage, fraction }),
      (stems) => post({ id, type: 'stems', stems }),
    );
    post({ id, type: 'done', readings, separationError });
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

import { defineConfig } from 'vitest/config';

// `pnpm score`：只跑 score/ 底下的測試（pnpm test 不含它們，因為要讀 samples/ 與 ffmpeg）
export default defineConfig({
  test: {
    environment: 'node',
    include: ['score/**/*.test.ts'],
    testTimeout: 600_000,
  },
});

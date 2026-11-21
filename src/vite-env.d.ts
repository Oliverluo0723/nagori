/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 分軌模型網址；不設就用同源的 public/models/（見 analysis/stems/separate.ts） */
  readonly VITE_STEMS_MODEL_URL?: string;
}

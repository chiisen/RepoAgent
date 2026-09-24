/**
 * @deprecated — 舊模組，新實作位於 `domain/config.ts` + `infrastructure/fs/configRepository.ts`。
 * 此檔保留僅為向後相容（測試 import）。
 */
export {
  configStore,
  defaults,
  ensurePromptTemplates,
  fillPrompt,
  loadConfig,
  normalizeRootDir,
  parsePromptTemplates,
  parseSkipDirs,
  resolveOptimizePrompt,
  saveConfig,
} from './_shims/config.js';

export type { ConfigStore, PromptTemplate } from './domain/types.js';

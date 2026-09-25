/**
 * @deprecated — 保留舊 `createConfigRouter()` 簽名。新實作位於 `routes/_internal/`。
 * 此檔保留僅為向後相容（測試 import）。
 */
import { sharedContainer } from '../composition/_sharedContainer.js';
import { createConfigRouter as _newCreateConfigRouter } from './_internal/config.js';

export function createConfigRouter(): ReturnType<typeof _newCreateConfigRouter> {
  return _newCreateConfigRouter(sharedContainer().configService);
}

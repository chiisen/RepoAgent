/**
 * 跨模組共用的 singleton container（composition、app 與 _shims 都引用此）。
 * 讓測試 mutate configStore 與生產 service 共用同一個 configRepo。
 */
import type { Container } from './container.js';
import { createContainer as buildContainer } from './container.js';

let sharedSingleton: Container | null = null;

export function sharedContainer(): Container {
  if (!sharedSingleton) sharedSingleton = buildContainer();
  return sharedSingleton;
}

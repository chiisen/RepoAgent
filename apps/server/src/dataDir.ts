/**
 * 倉庫根目錄的 data/。此檔在 apps/server/src/，往上三層是 monorepo 根。
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function repoDataDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data');
}

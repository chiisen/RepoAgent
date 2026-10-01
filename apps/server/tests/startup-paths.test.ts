import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { FileConfigRepository } from '../src/infrastructure/fs/configRepository.js';
import { defaultDbPath, resolveStartupDbPath } from '../src/infrastructure/sqlite/connection.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dataDir = join(repoRoot, 'data');

describe('預設資料路徑（issue #29 #30）', () => {
  const previous = process.env.REPOAGENT_DB;

  afterEach(() => {
    if (previous === undefined) delete process.env.REPOAGENT_DB;
    else process.env.REPOAGENT_DB = previous;
  });

  it('未設定 REPOAGENT_DB 時用 defaultDbPath()，不是 :memory:', () => {
    delete process.env.REPOAGENT_DB;
    const resolved = resolveStartupDbPath();
    expect(resolved).toBe(defaultDbPath());
    expect(resolved).not.toBe(':memory:');
  });

  it('明確傳入 :memory: 仍使用記憶體資料庫', () => {
    expect(resolveStartupDbPath(':memory:')).toBe(':memory:');
  });

  it('預設 db 與 config 都在倉庫根 data/，不是 apps/server/data/', () => {
    expect(defaultDbPath()).toBe(join(dataDir, 'repoagent.db'));
    expect(FileConfigRepository.defaultPath()).toBe(join(dataDir, 'config.json'));
    const wrong = `${sep}apps${sep}server${sep}data${sep}`;
    expect(defaultDbPath()).not.toContain(wrong);
    expect(FileConfigRepository.defaultPath()).not.toContain(wrong);
  });
});

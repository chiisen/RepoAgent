/**
 * 回歸測試（PR #18 review CRITICAL-2）：
 * PUT /api/config 的 rootDir 必須真正寫入記憶體並持久化到 config.json，
 * 而非「回應 200 但兩邊都沒更新」。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { createContainer } from '../src/composition/container.js';

let server: Server;
let port = 0;
let workDir = '';
let configPath = '';
let oldRoot = '';
let newRoot = '';

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'repoagent-config-'));
  configPath = join(workDir, 'config.json');
  oldRoot = join(workDir, 'old-root');
  newRoot = join(workDir, 'new-root');
  mkdirSync(oldRoot, { recursive: true });
  mkdirSync(newRoot, { recursive: true });
  writeFileSync(configPath, JSON.stringify({ rootDir: oldRoot }, null, 2));

  const container = createContainer({ dbPath: ':memory:', configPath });
  const app = createApp(container);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  port = addr.port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  rmSync(workDir, { recursive: true, force: true });
});

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function putConfig(body: unknown) {
  return api('/api/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PUT /api/config rootDir 持久化', () => {
  it('初始 GET /api/config 回傳磁碟上的 rootDir', async () => {
    const res = await api('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.rootDir).toBe(oldRoot);
  });

  it('PUT 後回應新值、GET 也讀到新值，且已寫入 config.json', async () => {
    const put = await putConfig({ rootDir: newRoot });
    expect(put.status).toBe(200);
    expect(put.body.rootDir).toBe(newRoot);

    const get = await api('/api/config');
    expect(get.body.rootDir).toBe(newRoot);

    const onDisk = JSON.parse(readFileSync(configPath, 'utf-8')) as { rootDir?: string };
    expect(onDisk.rootDir).toBe(newRoot);
  });

  it('其他設定與 rootDir 一起更新時兩者都要生效', async () => {
    const otherRoot = join(workDir, 'other-root');
    mkdirSync(otherRoot, { recursive: true });

    const put = await putConfig({ rootDir: otherRoot, timeout: 900 });
    expect(put.status).toBe(200);
    expect(put.body.rootDir).toBe(otherRoot);
    expect(put.body.timeout).toBe(900);

    const onDisk = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      rootDir?: string;
      timeout?: number;
    };
    expect(onDisk.rootDir).toBe(otherRoot);
    expect(onDisk.timeout).toBe(900);
  });

  it('不存在的 rootDir 回 400，且不覆蓋磁碟上的值', async () => {
    const before = JSON.parse(readFileSync(configPath, 'utf-8')) as { rootDir?: string };
    const put = await putConfig({ rootDir: join(workDir, 'does-not-exist') });
    expect(put.status).toBe(400);

    const after = JSON.parse(readFileSync(configPath, 'utf-8')) as { rootDir?: string };
    expect(after.rootDir).toBe(before.rootDir);
  });
});

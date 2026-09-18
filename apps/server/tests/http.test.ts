import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../src/app.js';
import { getScanProgress } from '../src/scanner.js';
import type { Server } from 'node:http';

let server: Server;
let port = 0;

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  port = addr.port;
});

afterAll(() => new Promise<void>((resolve, reject) => {
  server.close((err) => (err ? reject(err) : resolve()));
}));

describe('HTTP 煙霧', () => {
  it('GET / 回 200 HTML（dist 優先，否則 fallback）', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/html/i);
    const html = await res.text();
    expect(html).toMatch(/RepoAgent/);
    expect(html).toMatch(/btnScan|id="root"/);
    expect(res.headers.get('content-security-policy') ?? '').not.toMatch(/default-src 'none'/);
  });

  it('GET /favicon.ico 回 200', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/favicon.ico`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/svg|icon|octet/i);
  });

  it('GET /api/health', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('GET /api/scan/progress 契約', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/scan/progress`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({
      running: expect.any(Boolean),
      total: expect.any(Number),
      done: expect.any(Number),
      current: expect.any(String),
    }));
    const local = getScanProgress();
    expect(body).toEqual(local);
  });
});

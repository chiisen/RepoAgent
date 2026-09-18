import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const port = process.env.E2E_PORT || '34568';
const e2eDb = process.env.REPOAGENT_DB || join(tmpdir(), 'repoagent-e2e.db');

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: 'chromium',
  },
  webServer: {
    command: 'npx tsx src/index.ts',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    env: { ...process.env, PORT: port, REPOAGENT_DB: e2eDb },
    timeout: 30_000,
  },
});

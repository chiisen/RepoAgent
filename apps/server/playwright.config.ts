import { defineConfig } from '@playwright/test';

const port = process.env.E2E_PORT || '34568';

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
    env: { ...process.env, PORT: port },
    timeout: 30_000,
  },
});

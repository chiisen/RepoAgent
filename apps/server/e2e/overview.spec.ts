import { test, expect } from '@playwright/test';

test('總覽頁可開、無本頁例外', async ({ page }) => {
  const pageErrors: string[] = [];
  const pageConsoleErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const loc = msg.location().url ?? '';
    if (loc.includes('content_main.js') || loc.includes('chrome-extension://')) return;
    pageConsoleErrors.push(msg.text());
  });

  const res = await page.goto('/');
  expect(res?.ok()).toBeTruthy();
  await expect(page.locator('#btnScan')).toBeVisible();
  await expect(page.locator('#repoCount')).toContainText('專案');

  // issue #3：WS 應連上（同埠推播通道）
  await expect
    .poll(() => page.evaluate(() => (window as any).__wsOpen), { timeout: 10_000 })
    .toBe(true);

  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  expect(pageConsoleErrors, pageConsoleErrors.join('\n')).toEqual([]);
});

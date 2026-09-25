import { expect, test } from '@playwright/test';

test('設定抽屜開啟→儲存→toast', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.ok()).toBeTruthy();
  const settings = page.locator('#btnSettings');
  test.skip(!(await settings.count()), 'fallback 無設定鈕，略過（無 dist）');
  await settings.click();
  await expect(page.locator('#drawer')).toHaveClass(/open/);
  await expect(page.locator('#cfgRootDir')).toBeVisible();
  await expect(page.locator('#cfgPiPath')).toBeVisible();
  await expect(page.locator('#cfgPrompt')).toBeVisible();
  await expect(page.locator('#cfgTimeout')).toBeVisible();
  await page.locator('#btnSaveConfig').click();
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('設定已儲存');
});

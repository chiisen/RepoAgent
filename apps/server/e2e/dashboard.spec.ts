import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

function git(cwd: string, ...args: string[]) {
  execFileSync('git', [...args], { cwd, stdio: 'pipe' });
}

let root = '';

test.beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'repoagent-e2e-scan-'));
  for (const name of ['clean-repo', 'dirty-repo', 'not-a-repo'])
    mkdirSync(join(root, name), { recursive: true });
  for (const name of ['clean-repo', 'dirty-repo']) {
    const p = join(root, name);
    git(p, 'init');
    git(p, 'config', 'user.email', 't@t.t');
    git(p, 'config', 'user.name', 't');
    writeFileSync(join(p, 'f.txt'), 'hello');
    git(p, 'add', '.');
    git(p, 'commit', '-m', 'init');
  }
  writeFileSync(join(root, 'dirty-repo', 'f.txt'), 'hello dirty');
  writeFileSync(join(root, 'not-a-repo', 'x.txt'), 'x');
});

test.afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

test('掃描卡片、篩選、詳情、更新、優化', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#btnScan')).toBeVisible();

  // 不經 UI PUT config，避免改寫本機 data/config.json
  const scan = await page.request.post('/api/scan', { data: { rootDir: root } });
  expect(scan.ok()).toBeTruthy();
  const summary = await scan.json();
  expect(summary.total).toBe(2);
  expect(summary.okCount).toBe(2);

  await page.reload();
  await expect(page.locator('#repoCount')).toContainText('2 個專案');

  const clean = page.locator('.card', { hasText: 'clean-repo' });
  const dirty = page.locator('.card', { hasText: 'dirty-repo' });
  await expect(clean).toContainText('乾淨');
  await expect(dirty).toContainText('有變更');
  await expect(page.locator('.card', { hasText: 'not-a-repo' })).toHaveCount(0);

  await page.locator('#filter').selectOption('dirty');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(dirty).toBeVisible();

  await page.locator('#filter').selectOption('clean');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(clean).toBeVisible();

  await page.locator('#filter').selectOption('all');
  await page.locator('#sort').selectOption('name');
  await clean.getByRole('button', { name: '詳情' }).click();
  await expect(page.locator('#drawer')).toHaveClass(/open/);
  await expect(page.locator('#drawer')).toContainText('status');
  await expect(page.locator('#drawer')).toContainText('log -5');
  await page.locator('#closeD').click();

  await dirty.getByRole('button', { name: '更新' }).click();
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('工作區有未提交變更，已跳過 pull');
  await expect(page.locator('#toast')).toBeHidden({ timeout: 6_000 });

  await clean.getByRole('button', { name: '用 pi 優化' }).click();
  await expect
    .poll(async () => {
      const d = await page.locator('#drawer.open').isVisible();
      const t = await page.locator('#toast.show').isVisible();
      return d || t;
    })
    .toBe(true);
});

test('手機寬度總覽可用', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#btnScan')).toBeVisible();
  await expect(page.locator('#btnSettings')).toBeVisible();
  await expect(page.locator('#rootDir')).toBeVisible();
  await page.locator('#btnSettings').click();
  await expect(page.locator('#drawer')).toHaveClass(/open/);
  await expect(page.locator('#cfgPiPath')).toBeVisible();
});

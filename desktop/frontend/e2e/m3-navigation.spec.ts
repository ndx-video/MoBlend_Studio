import { test, expect } from '@playwright/test';
import { setupMockedApp } from './fixtures/mocks';
import { NAV_ITEMS, attachConsoleCollector, gotoHome, expectNoConsoleErrors } from './helpers';

test.describe('M3 — App shell & navigation', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockedApp(page);
    await gotoHome(page);
  });

  test('renders nav rail with all seven PRD routes', async ({ page }) => {
    await expect(page.getByTestId('nav-rail')).toBeVisible();
    for (const item of NAV_ITEMS) {
      await expect(page.getByTestId(item.testId)).toBeVisible();
    }
    await expect(page.getByTestId('app-header')).toContainText('Mo.Blend Studio');
  });

  test('renders bottom status bar with broker indicator', async ({ page }) => {
    await expect(page.getByTestId('status-bar')).toBeVisible();
    await expect(page.getByTestId('status-broker-dot')).toBeVisible();
    await expect(page.getByTestId('status-bar-message')).toBeVisible();
    await expect(page.getByTestId('status-bar-message')).not.toBeEmpty();
  });

  test('status bar click copies latest message to clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const msg = await page.getByTestId('status-bar-message').innerText();
    await page.getByTestId('status-bar').click();
    await expect(page.getByTestId('status-bar-copied')).toContainText('Copied', { timeout: 3000 });
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe(msg);
  });

  test('status bar double-click copies message history to clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByTestId('status-bar').dblclick();
    await expect(page.getByTestId('status-bar-copied')).toContainText('Copied full log', { timeout: 3000 });
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toMatch(/\[\d{1,2}:\d{2}:\d{2}/);
    expect(clip.split('\n').length).toBeGreaterThanOrEqual(1);
  });

  test('each nav item renders its screen without console errors', async ({ page }) => {
    const errors = attachConsoleCollector(page);

    for (const item of NAV_ITEMS) {
      await page.getByTestId(item.testId).click();
      if ('heading' in item && typeof item.heading === 'string') {
        await expect(page.getByRole('heading', { name: item.heading })).toBeVisible({ timeout: 8000 });
      } else if ('heading' in item) {
        await expect(page.getByRole('heading', { name: item.heading })).toBeVisible({ timeout: 8000 });
      } else {
        await expect(page.getByText(item.text)).toBeVisible({ timeout: 8000 });
      }
      await page.waitForTimeout(300);
    }

    expectNoConsoleErrors(errors, 'navigating all routes');
  });

  test('hash router preserves deep links', async ({ page }) => {
    await page.goto('/#/editor');
    await expect(page.getByTestId('viewport-canvas')).toBeVisible({ timeout: 8000 });

    await page.goto('/#/settings/suite');
    await expect(page.getByRole('heading', { name: /Suite Manager/i })).toBeVisible();
  });
});
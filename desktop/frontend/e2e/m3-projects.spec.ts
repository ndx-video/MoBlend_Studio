import { test, expect } from '@playwright/test';
import { setupMockedApp } from './fixtures/mocks';
import { gotoHome } from './helpers';

test.describe('M3 — Projects (recents)', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockedApp(page);
    await gotoHome(page);
    await page.getByTestId('nav-projects').click();
  });

  test('lists recent projects from Go binding', async ({ page }) => {
    const items = page.getByTestId('recent-project-item');
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText('m1_minimal_test.mo.blend');
  });

  test('clicking a recent project loads editor', async ({ page }) => {
    await page.getByTestId('recent-project-item').first().click();
    await expect(page.getByTestId('viewport-canvas')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('param-row-intensity')).toBeVisible();
  });
});
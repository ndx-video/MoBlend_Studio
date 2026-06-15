import { test, expect } from '@playwright/test';
import { setupMockedApp } from './fixtures/mocks';
import { gotoHome } from './helpers';

test.describe('M3 — Static screens (assets, export, settings)', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockedApp(page);
    await gotoHome(page);
  });

  test('assets screen explains sandbox drop flow', async ({ page }) => {
    await page.getByTestId('nav-assets').click();
    await expect(page.getByTestId('assets-screen')).toBeVisible();
    await expect(page.getByText(/Drag & drop files/i)).toBeVisible();
  });

  test('export screen documents editor-triggered jobs', async ({ page }) => {
    await page.getByTestId('nav-export').click();
    await expect(page.getByTestId('export-screen')).toBeVisible();
    await expect(page.getByText(/202 \+ job_id/i)).toBeVisible();
  });

  test('user settings screen references config path', async ({ page }) => {
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-screen')).toBeVisible();
    await expect(page.getByTestId('settings-screen').getByText(/\.moblend\\config\.json/i).first()).toBeVisible();
  });
});
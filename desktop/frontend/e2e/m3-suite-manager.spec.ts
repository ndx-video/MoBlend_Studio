import { test, expect } from '@playwright/test';
import { setupMockedApp } from './fixtures/mocks';
import { gotoHome } from './helpers';

test.describe('M3 — Suite Manager', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockedApp(page);
    await gotoHome(page);
    await page.getByTestId('nav-suite').click();
  });

  test('shows engine controls and health display', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Suite Manager/i })).toBeVisible();
    await expect(page.getByTestId('start-engine-btn')).toBeVisible();
    await expect(page.getByTestId('stop-engine-btn')).toBeVisible();
    await expect(page.getByTestId('refresh-health-btn')).toBeVisible();
    await expect(page.getByText(/Broker health/i)).toBeVisible();
  });

  test('start engine shows progress messaging', async ({ page }) => {
    await page.getByTestId('start-engine-btn').click();
    await expect(page.getByText(/Starting engine|Spawned Blender|successfully/i)).toBeVisible({ timeout: 4000 });
  });

  test('refresh health does not crash', async ({ page }) => {
    await page.getByTestId('refresh-health-btn').click();
    await expect(page.getByText(/Broker health/i)).toBeVisible();
  });
});
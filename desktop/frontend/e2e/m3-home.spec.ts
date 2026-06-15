import { test, expect } from '@playwright/test';
import { setupMockedApp } from './fixtures/mocks';
import { gotoHome } from './helpers';

test.describe('M3 — Home / gallery load flow', () => {
  let brokerState: Awaited<ReturnType<typeof setupMockedApp>>;

  test.beforeEach(async ({ page }) => {
    brokerState = await setupMockedApp(page);
    await gotoHome(page);
  });

  test('shows Stitch-aligned gallery cards', async ({ page }) => {
    await expect(page.getByText(/RECOMMENDED/i)).toBeVisible();
    await expect(page.getByText(/M1 Test Template/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Open in Editor/i })).toBeVisible();
    await expect(page.getByText(/LOCAL FILES/i)).toBeVisible();
    await expect(page.getByText(/Open \.mo\.blend/i)).toBeVisible();
  });

  test('default card loads project and navigates to editor with manifest', async ({ page }) => {
    await page.getByTestId('open-in-editor-btn').click();
    await expect(page.getByTestId('viewport-canvas')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('param-row-intensity')).toBeVisible();
    await expect(page.getByTestId('param-row-style_preset')).toBeVisible();

    const loadCalls = brokerState.calls.filter(c => c.url.includes('/project/load'));
    expect(loadCalls.length).toBeGreaterThanOrEqual(1);
  });

  test('open local triggers file picker mock and broker load', async ({ page }) => {
    await page.getByText(/Open \.mo\.blend/i).click();
    await expect(page.getByTestId('viewport-canvas')).toBeVisible({ timeout: 8000 });
    expect(brokerState.calls.some(c => c.url.includes('/project/load'))).toBe(true);
  });
});
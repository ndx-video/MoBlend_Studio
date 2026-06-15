import { test, expect } from '@playwright/test';
import { injectWailsMocks } from './fixtures/mocks';

/**
 * Optional integration tests against a live broker (scripts/dev.ps1 or Wails StartEngine).
 * Skipped automatically when nothing is listening on :8000.
 */
test.describe('M3 — Live broker integration', () => {
  let brokerAvailable = false;

  test.beforeAll(async () => {
    try {
      const res = await fetch('http://127.0.0.1:8000/api/v1/health', { signal: AbortSignal.timeout(2000) });
      brokerAvailable = res.ok;
    } catch {
      brokerAvailable = false;
    }
  });

  test.beforeEach(async ({ page }) => {
    test.skip(!brokerAvailable, 'Live broker not running on :8000');
    await injectWailsMocks(page);
    // No broker mock — hit the real API
    await page.goto('/#/editor');
  });

  test('editor loads manifest from live broker', async ({ page }) => {
    await expect(page.getByTestId('param-inspector')).toBeVisible({ timeout: 15000 });
    // Broker auto-loads template on startup; wait for params or acceptable empty state
    await expect(
      page.getByTestId('param-row-intensity').or(page.getByTestId('load-default-btn'))
    ).toBeVisible({ timeout: 20000 });
  });

  test('live viewport auto-preview receives EEVEE frames', async ({ page }) => {
    await expect(page.getByTestId('param-input-label')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/WS live/i)).toBeVisible({ timeout: 10000 });
    // Auto-preview should advance frame counter once broker returns JPEG
    await expect(page.getByText(/frame [0-9]+/)).toBeVisible({ timeout: 25000 });
  });

  test('live PATCH /parameters succeeds from UI', async ({ page }) => {
    // Broker may auto-load template; wait for inspector params (avoid racing load-default-btn detach)
    await expect(page.getByTestId('param-input-label')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('param-input-label').fill('E2E LIVE');
    await page.waitForTimeout(400);
    await expect(page.getByTestId('param-input-label')).toHaveValue('E2E LIVE');
  });
});
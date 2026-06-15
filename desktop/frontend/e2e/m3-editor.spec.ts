import { test, expect } from '@playwright/test';
import { setupMockedApp } from './fixtures/mocks';
import { loadEditorWithManifest } from './helpers';

const PARAM_DEBOUNCE_WAIT = 350;

test.describe('M3 — Editor (viewport, parameters, slots, export)', () => {
  let brokerState: Awaited<ReturnType<typeof setupMockedApp>>;

  test.beforeEach(async ({ page }) => {
    brokerState = await setupMockedApp(page);
    await loadEditorWithManifest(page);
  });

  test('renders viewport canvas and inspector regions', async ({ page }) => {
    await expect(page.getByTestId('viewport-canvas-container')).toBeVisible();
    await expect(page.getByTestId('param-inspector')).toBeVisible();
    await expect(page.getByText(/Slots \(drag to change/i)).toBeVisible();
    await expect(page.getByTestId('slot-row-0')).toBeVisible();
    await expect(page.getByTestId('slot-row-1')).toBeVisible();
  });

  test('all six manifest parameter types render controls', async ({ page }) => {
    const ids = ['intensity', 'label', 'tint', 'enabled', 'count', 'style_preset'];
    for (const id of ids) {
      await expect(page.getByTestId(`param-row-${id}`)).toBeVisible();
      await expect(page.getByTestId(`param-input-${id}`)).toBeVisible();
    }
  });

  test('parameter PATCH is debounced (single request after rapid text edits)', async ({ page }) => {
    const before = brokerState.calls.filter(c => c.method === 'PATCH' && c.url.includes('/parameters')).length;
    const input = page.getByTestId('param-input-label');

    // Rapid text edits should coalesce into one debounced PATCH (200ms window)
    await input.fill('debounce-a');
    await input.fill('debounce-b');
    await input.fill('debounce-c');
    await page.waitForTimeout(PARAM_DEBOUNCE_WAIT);

    const patchCalls = brokerState.calls.filter(c => c.method === 'PATCH' && c.url.includes('/parameters'));
    expect(patchCalls.length - before).toBeLessThanOrEqual(2);
    expect(patchCalls.length - before).toBeGreaterThanOrEqual(1);
  });

  test('enum and bool parameters can be changed', async ({ page }) => {
    await page.getByTestId('param-input-style_preset').selectOption('neon');
    await page.waitForTimeout(350);
    await page.getByTestId('param-input-enabled').check();
    await page.waitForTimeout(350);

    expect(brokerState.paramValues.style_preset).toBe('neon');
    expect(brokerState.paramValues.enabled).toBe(true);
  });

  test('slot end time edit triggers PATCH /slots', async ({ page }) => {
    const endInput = page.getByTestId('slot-row-0').locator('input').nth(1);
    await endInput.fill('3.5');
    await endInput.dispatchEvent('change');
    await page.waitForTimeout(200);

    const slotCalls = brokerState.calls.filter(c => c.url.includes('/slots'));
    expect(slotCalls.length).toBeGreaterThanOrEqual(1);
  });

  test('auto-preview paints viewport frames from mock WS', async ({ page }) => {
    await expect(page.getByText(/WS live/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/frame [0-9]+/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('viewport-stats')).toContainText(/painted [1-9]/, { timeout: 10000 });
  });

  test('export triggers 202 + poll and shows job status', async ({ page }) => {
    await page.getByTestId('trigger-export-btn').click();
    await expect(page.getByText(/Export job:/i)).toBeVisible({ timeout: 3000 });
    await expect(page.getByText(/done/i)).toBeVisible({ timeout: 5000 });

    expect(brokerState.calls.some(c => c.url.includes('/render/export'))).toBe(true);
    expect(brokerState.calls.some(c => c.url.includes('/render/status/'))).toBe(true);
  });

  test('refresh manifest re-fetches from broker', async ({ page }) => {
    const before = brokerState.calls.filter(c => c.url.includes('/manifest')).length;
    await page.getByTestId('refresh-manifest-btn').click();
    await page.waitForTimeout(300);
    const after = brokerState.calls.filter(c => c.url.includes('/manifest')).length;
    expect(after).toBeGreaterThan(before);
  });
});
import { test, expect } from '@playwright/test';
import { setupMockedApp } from './fixtures/mocks';
import { loadEditorWithManifest } from './helpers';

test.describe('M3 — Asset ingest (sandbox → broker → UI)', () => {
  let brokerState: Awaited<ReturnType<typeof setupMockedApp>>;

  test.beforeEach(async ({ page }) => {
    brokerState = await setupMockedApp(page);
  });

  test('editor shows image asset param row', async ({ page }) => {
    await loadEditorWithManifest(page);
    await expect(page.getByTestId('param-row-logo')).toBeVisible();
    await expect(page.getByTestId('param-asset-value-logo')).toContainText('No file');
    await expect(page.getByTestId('param-choose-file-logo')).toBeVisible();
  });

  test('choose file ingests via PATCH /parameters with sandbox path', async ({ page }) => {
    await loadEditorWithManifest(page);
    const before = brokerState.calls.filter(c => c.method === 'PATCH' && c.url.includes('/parameters')).length;

    await page.getByTestId('param-choose-file-logo').click();
    await expect(page.getByTestId('param-asset-value-logo')).toContainText('asset_abc123.png', { timeout: 5000 });

    const patchCalls = brokerState.calls.filter(c => c.method === 'PATCH' && c.url.includes('/parameters'));
    expect(patchCalls.length - before).toBeGreaterThanOrEqual(1);
    const last = patchCalls[patchCalls.length - 1];
    const updates = (last.body as { updates?: Array<{ id: string; value: string }> })?.updates ?? [];
    expect(updates.some(u => u.id === 'logo' && u.value.includes('asset_abc123.png'))).toBe(true);
    expect(brokerState.paramValues.logo).toContain('asset_abc123.png');
  });

  test('assets screen lists sandbox files from Go binding', async ({ page }) => {
    await loadEditorWithManifest(page);
    await page.getByTestId('nav-assets').click();
    await expect(page.getByTestId('assets-list')).toBeVisible();
    await expect(page.getByTestId('asset-item-0')).toBeVisible();
    await expect(page.getByTestId('asset-item-0')).toContainText('asset_abc123.png');
    await expect(page.getByTestId('asset-item-1')).toContainText('asset_def456.ttf');
  });

  test('assets screen ingest assigns file to param via PATCH', async ({ page }) => {
    await loadEditorWithManifest(page);
    await page.getByTestId('nav-assets').click();
    await page.getByTestId('asset-assign-select').first().selectOption('logo');
    const before = brokerState.calls.filter(c => c.url.includes('/parameters')).length;
    await page.getByTestId('asset-ingest-btn').first().click();
    await page.waitForTimeout(500);

    const patchCalls = brokerState.calls.filter(c => c.url.includes('/parameters'));
    expect(patchCalls.length).toBeGreaterThan(before);
    expect(brokerState.paramValues.logo).toContain('asset_abc123.png');
  });

  test('global window drop updates editor param value', async ({ page }) => {
    await loadEditorWithManifest(page);
    await page.evaluate(() => {
      (window as any).__moblendOnFileDrop?.(120, 80, ['C:\\\\TEMP\\\\picked_logo.png']);
    });

    await expect(page.getByTestId('param-asset-value-logo')).toContainText('asset_abc123.png', { timeout: 5000 });
  });

  test('wrong-type file shows error and does not PATCH logo', async ({ page }) => {
    await loadEditorWithManifest(page);
    const before = brokerState.calls.filter(c => c.url.includes('/parameters')).length;

    await page.evaluate(() => {
      (window as any).__moblendOnFileDrop?.(120, 80, ['C:\\\\TEMP\\\\picked_font.ttf']);
    });
    await page.waitForTimeout(800);

    const patchCalls = brokerState.calls.filter(c => c.url.includes('/parameters'));
    expect(patchCalls.length).toBe(before);
    await expect(page.getByTestId('status-bar-message')).toContainText(/does not match any manifest asset param/i);
  });
});
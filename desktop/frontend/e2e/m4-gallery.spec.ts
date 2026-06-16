import { test, expect } from '@playwright/test';
import { setupMockedApp, MOCK_CATALOG_ENTRY } from './fixtures/mocks';
import { gotoHome } from './helpers';

test.describe('M4 — Gallery catalog install flow', () => {
  let brokerState: Awaited<ReturnType<typeof setupMockedApp>>;

  test.beforeEach(async ({ page }) => {
    brokerState = await setupMockedApp(page);
    await gotoHome(page);
  });

  test('gallery shows catalog card with preview and name', async ({ page }) => {
    const card = page.getByTestId(`gallery-catalog-card-${MOCK_CATALOG_ENTRY.template_id}`);
    await expect(card).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId(`gallery-preview-${MOCK_CATALOG_ENTRY.template_id}`)).toHaveAttribute('alt', MOCK_CATALOG_ENTRY.name);
    await expect(card.getByText(MOCK_CATALOG_ENTRY.name, { exact: true })).toBeVisible();
    await expect(page.getByTestId(`gallery-install-btn-${MOCK_CATALOG_ENTRY.template_id}`)).toBeVisible();
  });

  test('install opens editor with viewport', async ({ page }) => {
    await expect(page.getByTestId(`gallery-install-btn-${MOCK_CATALOG_ENTRY.template_id}`)).toBeVisible({ timeout: 8000 });
    await page.getByTestId(`gallery-install-btn-${MOCK_CATALOG_ENTRY.template_id}`).click();
    await expect(page.getByTestId('viewport-canvas')).toBeVisible({ timeout: 8000 });

    const loadCalls = brokerState.calls.filter(c => c.url.includes('/project/load'));
    expect(loadCalls.length).toBeGreaterThanOrEqual(1);
    const loadedPath = (loadCalls[0]?.body as { template_path?: string } | undefined)?.template_path ?? '';
    expect(loadedPath).toContain('parametric-cube-demo.mo.blend');
    expect(loadedPath).toContain('.moblend');
  });

  test('suite manager shows catalog status', async ({ page }) => {
    await page.getByTestId('nav-suite').click();
    await expect(page.getByTestId('catalog-status-panel')).toBeVisible();
    await expect(page.getByTestId('registry-base-url')).toContainText('MoBlend_Lib');
    await expect(page.getByTestId('catalog-entry-count')).toHaveText('1');
    await expect(page.getByTestId('catalog-refresh-btn')).toBeVisible();
  });
});

test.describe('M4 — Gallery open installed template', () => {
  test('open button loads editor without install', async ({ page }) => {
    const brokerState = await setupMockedApp(page, { installedTemplateIds: [MOCK_CATALOG_ENTRY.template_id] });
    await gotoHome(page);
    await expect(page.getByTestId(`gallery-open-btn-${MOCK_CATALOG_ENTRY.template_id}`)).toBeVisible({ timeout: 8000 });
    await page.getByTestId(`gallery-open-btn-${MOCK_CATALOG_ENTRY.template_id}`).click();
    await expect(page.getByTestId('viewport-canvas')).toBeVisible({ timeout: 8000 });
    expect(brokerState.calls.some(c => c.url.includes('/project/load'))).toBe(true);
  });
});
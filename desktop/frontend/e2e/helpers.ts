import { Page, expect } from '@playwright/test';

export const NAV_ITEMS = [
  { testId: 'nav-home', route: '/', heading: /Template Gallery/i },
  { testId: 'nav-projects', route: '/#/projects', text: /RECENT PROJECTS/i },
  { testId: 'nav-assets', route: '/#/assets', text: /LOCAL ASSETS/i },
  { testId: 'nav-editor', route: '/#/editor', text: /Parameters \(live\)/i },
  { testId: 'nav-export', route: '/#/export', heading: 'Export' },
  { testId: 'nav-suite', route: '/#/settings/suite', heading: /Suite Manager/i },
  { testId: 'nav-settings', route: '/#/settings', text: /USER SETTINGS/i },
] as const;

export function attachConsoleCollector(page: Page) {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

export async function gotoHome(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Template Gallery/i })).toBeVisible({ timeout: 10000 });
}

export async function openEditor(page: Page) {
  await page.getByTestId('nav-editor').click();
  await expect(page.getByTestId('param-inspector')).toBeVisible({ timeout: 8000 });
}

export async function loadEditorWithManifest(page: Page) {
  await gotoHome(page);
  await page.getByText(/M1 Test Template/i).click();
  await expect(page.getByTestId('viewport-canvas')).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId('param-row-intensity')).toBeVisible({ timeout: 8000 });
}

export async function expectNoConsoleErrors(errors: string[], context: string) {
  expect(errors, `${context}: ${errors.join(' | ')}`).toHaveLength(0);
}
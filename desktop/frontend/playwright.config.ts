import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for Mo.Blend Studio frontend.
 *
 * Runs against the Vite dev server (or preview) with heavy mocking of:
 * - Wails Go bindings (window.go.main.App.*)
 * - Wails runtime (window.runtime.*)
 * - Broker REST calls (/api/v1/*)
 *
 * This allows fast, headless GUI iteration and verification without
 * launching the full Wails app + headless Blender broker every time.
 *
 * Use `npm run test:e2e` (headless) or `npm run test:e2e:headed` / `test:e2e:ui`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Automatically start Vite dev server for the tests and wait for it to be ready.
  // This makes `npm run test:e2e` a one-command experience.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});

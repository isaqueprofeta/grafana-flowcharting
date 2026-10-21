/**
 * Playwright configuration for the FlowCharting panel end-to-end suite
 * (Task 13.2, Req 11.2 / 11.3).
 *
 * Follows the `@grafana/create-plugin` e2e convention: `@grafana/plugin-e2e`
 * layers Grafana-aware fixtures (`createDataSourceConfigPage`, `gotoDashboardPage`,
 * `panelEditPage`, ...) and expect matchers on top of `@playwright/test`. The
 * specs live under `tests/e2e/` and run against a live Grafana — the committed
 * Demo_Stack (`docker compose up`, Grafana 11.3 + Prometheus + the synthetic
 * metrics generator, see `docker-compose.yaml`).
 *
 * Flow:
 *   1. `docker compose up --build`         # build the plugin into ./dist first (npm run build)
 *   2. `npm run e2e`                        # runs `playwright test` against http://localhost:3000
 *
 * The Grafana base URL is taken from `GRAFANA_URL` (default http://localhost:3000),
 * so the same specs run against the Demo_Stack locally and against a
 * matrix-provisioned Grafana in CI.
 */
import { dirname } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import type { PluginOptions } from '@grafana/plugin-e2e';

const pluginE2eAuth = `${dirname(require.resolve('@grafana/plugin-e2e'))}/auth`;

export default defineConfig<PluginOptions>({
  testDir: './tests/e2e',
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only. */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: process.env.GRAFANA_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    // 1. Log in to Grafana and store the authentication state on disk so the
    //    actual test projects can reuse it without logging in again.
    {
      name: 'auth',
      testDir: pluginE2eAuth,
      testMatch: [/.*\.js/],
    },
    // 2. Run the FlowCharting e2e specs as an authenticated admin.
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/admin.json',
      },
      dependencies: ['auth'],
    },
  ],
});

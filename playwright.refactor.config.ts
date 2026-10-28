import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './src/test/browser',
  testMatch: 'refactor-preservation.spec.ts',
  outputDir: './artifacts/audits/refactor-browser',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3123',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run start -- --hostname 127.0.0.1 --port 3123',
    url: 'http://127.0.0.1:3123/login',
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      JWT_ACCESS_SECRET: 'refactor-fixture-only-access-secret-32-bytes',
      JWT_REFRESH_SECRET: 'refactor-fixture-only-refresh-secret-32-bytes',
      DATABASE_URL: 'postgresql://disabled:disabled@127.0.0.1:1/bbe_refactor_fixture',
      DIRECT_URL: 'postgresql://disabled:disabled@127.0.0.1:1/bbe_refactor_fixture',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
})

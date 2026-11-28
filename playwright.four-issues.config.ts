import { defineConfig, devices } from '@playwright/test'

// 100% mocked APIs; dummy unreachable DB URL guarantees zero contact with production DB.
export default defineConfig({
  testDir: './src/test/browser',
  testMatch: 'four-issues-verification.spec.ts',
  outputDir: './test-results/four-issues',
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3125',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 900 } } },
  ],
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3125',
    url: 'http://127.0.0.1:3125/login',
    timeout: 180000,
    reuseExistingServer: false,
    env: {
      JWT_ACCESS_SECRET: 'four-issues-local-mock-secret-32b',
      DATABASE_URL: 'postgresql://unit_tests@127.0.0.1:1/bbe_test_unit',
      DIRECT_URL: 'postgresql://unit_tests@127.0.0.1:1/bbe_test_unit',
    },
  },
})

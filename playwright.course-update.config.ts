import { defineConfig, devices } from '@playwright/test'

// All API calls are intercepted; this server has a fixture signing secret and no DB configuration.
export default defineConfig({
  testDir: './src/test/browser', testMatch: 'course-update.spec.ts',
  outputDir: './test-results/p02b-browser', timeout: 60000, expect: { timeout: 15000 }, workers: 1,
  reporter: [['list']], use: { baseURL: 'http://127.0.0.1:3120', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['Pixel 7'] } }],
  webServer: { command: 'npm run dev -- --hostname 127.0.0.1 --port 3120', url: 'http://127.0.0.1:3120/login', timeout: 180000, reuseExistingServer: false,
    env: { JWT_ACCESS_SECRET: 'p02b-browser-fixture-secret-only-32', DATABASE_URL: 'postgresql://unit_tests@127.0.0.1:1/bbe_test_unit', DIRECT_URL: 'postgresql://unit_tests@127.0.0.1:1/bbe_test_unit' } },
})

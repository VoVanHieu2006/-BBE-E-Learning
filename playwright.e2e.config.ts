import { defineConfig, devices } from '@playwright/test'

// Real end-to-end suite: real UI + real API + real disposable PostgreSQL. Start it with `npm run test:e2e`
// (scripts/test/run-e2e.mjs resets the database and builds first); the guard below refuses any other target.
const { PORT, HOST, BASE_URL, validateE2eTarget, appEnv } = require('./scripts/test/e2e-target.cjs')
const databaseUrl = process.env.E2E_DATABASE_URL
validateE2eTarget(databaseUrl)
const baseURL = BASE_URL

export default defineConfig({
  testDir: './src/test/e2e',
  outputDir: './artifacts/e2e/results',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  // One shared database: specs create their own accounts, but run serially to keep quota/leaderboard facts stable.
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['html', { outputFolder: './artifacts/e2e/report', open: 'never' }], ['json', { outputFile: './artifacts/e2e/results.json' }]],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure', locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' },
  projects: [
    { name: 'api', testMatch: 'api/**/*.spec.ts' },
    { name: 'desktop', testMatch: ['ui/**/*.spec.ts', 'ux/**/*.spec.ts'], use: { ...devices['Desktop Chrome'] }, dependencies: ['api'] },
    { name: 'mobile', testMatch: 'ux/**/*.spec.ts', use: { ...devices['Pixel 7'] }, dependencies: ['desktop'] },
  ],
  webServer: {
    command: `npm run start -- --hostname ${HOST} --port ${PORT}`,
    url: `${baseURL}/login`,
    timeout: 120_000,
    reuseExistingServer: process.env.E2E_REUSE_SERVER === '1',
    env: appEnv(databaseUrl),
  },
})

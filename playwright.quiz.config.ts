import { defineConfig, devices } from '@playwright/test'

// QUIZ_BASE_URL reuses an already running app (APIs are mocked per test);
// otherwise a dev server is started on its own port.
const external = process.env.QUIZ_BASE_URL

export default defineConfig({
  testDir: './src/test/browser',
  testMatch: 'quiz-invite.spec.ts',
  outputDir: './scratch/quiz-browser-results',
  timeout: 60000,
  expect: { timeout: 12000 },
  workers: 1,
  reporter: [['list']],
  use: { baseURL: external || 'http://127.0.0.1:3118', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: external ? undefined : {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3118',
    url: 'http://127.0.0.1:3118/login',
    timeout: 180000,
    reuseExistingServer: false,
  },
})

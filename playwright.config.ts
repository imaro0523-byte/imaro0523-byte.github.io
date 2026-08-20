import { defineConfig, devices } from '@playwright/test';

import { E2E_ORIGIN, E2E_PORT } from './tests/e2e/origin';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: E2E_ORIGIN,
    trace: 'off',
    // Screenshots and traces are off by default: an artefact of a failing run
    // would otherwise contain whatever roster was on screen.
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Tests run against the production build, so the CSP and the service
    // worker under test are the ones users actually get.
    command: `npm run build:app && npx vite preview --port ${E2E_PORT} --host 127.0.0.1`,
    url: E2E_ORIGIN,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

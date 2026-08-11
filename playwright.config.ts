import { defineConfig, devices } from '@playwright/test';
import { prepareFixtureSnapshot } from './tests/e2e/fixture-lifecycle';

prepareFixtureSnapshot();

const previewPort = 4173;
const previewUrl = `http://127.0.0.1:${previewPort}/taiwan-stock-candlestick-guide/`;

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: '.cache/playwright-results',
  fullyParallel: false,
  workers: 1,
  globalTeardown: './tests/e2e/global-teardown.ts',
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [['list']],
  use: {
    baseURL: previewUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: `npx vitepress build . && npx vitepress preview . --host 127.0.0.1 --port ${previewPort}`,
    url: previewUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      name: 'chromium-mobile',
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});

import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const evidenceDir = path.resolve(__dirname, '../../../MOBILE_APP_PLANNING/evidence/playwright');

export default defineConfig({
  testDir: './journeys',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  reporter: [['list'], ['html', { outputFolder: path.join(evidenceDir, 'report'), open: 'never' }]],
  use: {
    baseURL: 'http://localhost:8081',
    viewport: { width: 390, height: 844 },
    screenshot: 'on',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'web',
      use: { ...devices['iPhone 14'], browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'npx expo start --web --port 8081',
    port: 8081,
    timeout: 120_000,
    reuseExistingServer: true,
    cwd: path.resolve(__dirname, '../..'),
  },
  outputDir: path.join(evidenceDir, 'results'),
});

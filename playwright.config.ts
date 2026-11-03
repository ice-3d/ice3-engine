import {
  defineConfig,
  devices,
  type BrowserChannel,
} from '@playwright/test';

const browserChannel = process.env.PLAYWRIGHT_CHANNEL as BrowserChannel | undefined;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:8103',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev:example -- --host 127.0.0.1 --port 8103',
      url: 'http://127.0.0.1:8103',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run dev:example:m1 -- --host 127.0.0.1 --port 8104',
      url: 'http://127.0.0.1:8104',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run dev:example:m2 -- --host 127.0.0.1 --port 8115',
      url: 'http://127.0.0.1:8115',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(browserChannel ? { channel: browserChannel } : {}),
      },
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});

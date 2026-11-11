import { defineConfig, devices } from '@playwright/test';

const RELAY_PORT = 8791;
const CLIENT_PORT = 5191;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    ...devices['Pixel 7'],
  },
  webServer: [
    {
      command: 'npm run relay',
      url: `http://localhost:${RELAY_PORT}/api/health`,
      // The tests let a bot play each minute-long leg instantly, so the speed check is off here only.
      env: { PORT: String(RELAY_PORT), RELAY_SKIP_SPEED_CHECK: '1' },
      reuseExistingServer: false,
    },
    {
      command: `npx vite --port ${CLIENT_PORT} --strictPort`,
      url: `http://localhost:${CLIENT_PORT}`,
      env: { VITE_RELAY_URL: `http://localhost:${RELAY_PORT}` },
      reuseExistingServer: false,
    },
  ],
});

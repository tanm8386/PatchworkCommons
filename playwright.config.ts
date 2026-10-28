import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    screenshot: 'off',
    // Continuous scene/DOM capture can stall software WebGL. Keep action traces
    // and capture explicit still images after freezing the rendered scene.
    trace: { mode: 'retain-on-failure', screenshots: false, snapshots: false, sources: true },
  },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI, timeout: 30_000 },
});

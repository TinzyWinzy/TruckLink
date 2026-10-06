import { defineConfig, devices } from '@playwright/test'

// Demo-mode harness: blank Firebase keys + empty VITE_API_URL force
// isLive()=false so gate sign-in renders the role-switcher tabs (.env.local
// would otherwise boot live mode — process env must override it).
const demoEnv = {
  VITE_FIREBASE_API_KEY: 'x',
  VITE_FIREBASE_AUTH_DOMAIN: 'x',
  VITE_FIREBASE_PROJECT_ID: '',
  VITE_FIREBASE_STORAGE_BUCKET: 'x',
  VITE_FIREBASE_MESSAGING_SENDER_ID: 'x',
  VITE_FIREBASE_APP_ID: '',
  VITE_FACILITY_ID: 'demo-facility',
  VITE_API_URL: '',
  VITE_SYNC_API_URL: '',
  VITE_POWERSYNC_URL: '',
}

export default defineConfig({
  testDir: './e2e',
  outputDir: process.env.PW_PROD ? './test-results/production' : './test-results/practice',
  fullyParallel: true,
  workers: 2,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5199',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // prod-smoke targets the deployed site; e2e/live needs the Django
      // bootstrap harness (playwright.live.config.ts).
      testIgnore: ['**/prod-smoke.spec.ts', '**/prod-admin.spec.ts', '**/prod-modelling.spec.ts', '**/prod-routes.spec.ts', '**/prod-tenant.spec.ts', '**/live/**', '**/regulatory/**', '**/stories/**'],
    },
    // Only with PW_PROD=1: the deployed site needs no local webServer.
    ...(process.env.PW_PROD
      ? [
          {
            name: 'production',
            use: { ...devices['Desktop Chrome'], baseURL: process.env.PW_PROD_URL || 'https://trucki-two.vercel.app' },
            testMatch: ['**/prod-smoke.spec.ts', '**/prod-admin.spec.ts', '**/prod-modelling.spec.ts', '**/prod-routes.spec.ts', '**/prod-tenant.spec.ts'],
          },
        ]
      : []),
  ],
  // PW_PROD=1 targets the deployed URL — no local server needed.
  webServer: process.env.PW_PROD
    ? undefined
    : {
        command: 'npx vite --port 5199 --strictPort --host 127.0.0.1',
        url: 'http://127.0.0.1:5199',
        reuseExistingServer: false,
        timeout: 90000,
        env: demoEnv,
      },
})

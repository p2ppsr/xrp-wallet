import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:4193',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run preview -- --port 4193',
    url: 'http://127.0.0.1:4193',
    reuseExistingServer: false,
    timeout: 30000
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }
    },
    {
      name: 'tablet',
      use: { ...devices['iPad Pro 11'] }
    },
    {
      name: 'wide-short',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1776, height: 760 } }
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] }
    }
  ]
})

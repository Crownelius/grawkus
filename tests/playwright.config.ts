import { defineConfig, devices } from '@playwright/test'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'

const GRAWKUS_BIN = path.join(process.cwd(), 'bin', 'grawkus.js')

/**
 * Generate a unique temp config directory for each test worker.
 * Sets GRAWKUS_HOME so the CLI uses an isolated config.
 */
function createTestConfigDir(): string {
  const dir = path.join(os.tmpdir(), `grawkus-e2e-${process.pid}-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'playwright-results.xml' }],
    ['json', { outputFile: 'playwright-results.json' }],
  ],
  use: {
    baseURL: 'http://localhost',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,

    // CLI-specific defaults
    cliBin: GRAWKUS_BIN,
    testConfigDir: createTestConfigDir,
  },
  projects: [
    { name: 'node20', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: undefined, // CLI app — no web server needed
})
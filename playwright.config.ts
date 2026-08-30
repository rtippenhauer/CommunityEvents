import { defineConfig, devices } from '@playwright/test';

/**
 * Browser-level e2e, the third leg of the testing stack REQ-TENANT-01.6
 * specifies: Vitest for unit tests, Vitest + Supertest for API integration
 * (api/test/*.e2e-spec.ts, which are HTTP-level but in-process), Playwright
 * for anything that needs a real browser.
 *
 * This lives at the repo root rather than inside frontend/ because the suite
 * is meant to grow into cross-cutting flows — a member signing in, RSVPing and
 * seeing the leaderboard update — which span both workspaces. Right now it
 * holds a smoke spec only.
 *
 * The dev server is started for you and no API is required: BrandConfigService
 * is built to fall back to defaults when /config/branding fails, so the app
 * shell renders on its own. A spec that needs real data has to bring up the
 * API and a database itself, and should say so at the top of the file.
 */
const PORT = 4300;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  /**
   * Playwright's own bundled Chromium, in a throwaway profile per test.
   *
   * `devices['Desktop Chrome']` is a **device descriptor** -- viewport, user
   * agent, scale factor -- and not a browser selector. It does not use the
   * Chrome installed on this machine, and it is worth knowing the difference
   * because the two read alike.
   *
   * **Do not add `channel: 'chrome'` (or `executablePath`) here.** That would
   * launch the developer's real Chrome, and the reason to avoid it is not
   * theoretical: Playwright would still supply its own `--user-data-dir`, but
   * a second Chrome process against a machine-wide install is exactly how test
   * runs start interfering with a browser somebody is using for real. The
   * bundled Chromium has neither problem and is what CI runs anyway, so a spec
   * that passes locally and fails in CI is one less thing to chase.
   *
   * `launchPersistentContext`/`userDataDir` are likewise absent on purpose.
   * Each test gets a fresh ephemeral context, so `fullyParallel` workers share
   * no browser state and cannot corrupt one another. If persistent state is
   * ever genuinely needed -- a signed-in session reused across specs -- reach
   * for `storageState` (a JSON file of cookies and localStorage) rather than a
   * persistent profile: it is per-worker safe, diffable, and cannot touch a
   * real browser installation.
   */
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: `npm --prefix frontend run start -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    // A cold `ng serve` compiles the whole app before it answers.
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

// Logs in as the dedicated automation account (see AddAutomationRole migration
// and CLAUDE_AUTOMATION_SECRET) and opens a page in headless Chromium to check
// it visually — screenshots, console errors, and element geometry.
//
// Usage:
//   AUTOMATION_SECRET=<secret> node check-page.js <baseUrl> <path> [outFile] [width] [height]
//
// Example:
//   AUTOMATION_SECRET=... node check-page.js https://stage.dinnerbears.com /login out.png 390 844

const { chromium } = require('playwright');

const [, , baseUrl, path, outFile, width, height] = process.argv;
const secret = process.env.AUTOMATION_SECRET;

if (!baseUrl || !path || !secret) {
  console.error('Usage: AUTOMATION_SECRET=<secret> node check-page.js <baseUrl> <path> [outFile] [width] [height]');
  process.exit(1);
}

(async () => {
  const loginRes = await fetch(`${baseUrl}/api/v1/auth/automation-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret }),
  });
  if (!loginRes.ok) {
    console.error('Automation login failed:', loginRes.status, await loginRes.text());
    process.exit(1);
  }
  const { accessToken } = await loginRes.json();

  const url = new URL(baseUrl);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: Number(width) || 1280, height: Number(height) || 800 },
  });
  await context.addCookies([
    {
      name: 'access_token',
      value: accessToken,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      secure: url.protocol === 'https:',
    },
  ]);

  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(`${baseUrl}${path}`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1000);

  const shotName = outFile || 'check.png';
  await page.screenshot({ path: shotName, fullPage: true });

  console.log('SCREENSHOT:', shotName);
  console.log('CONSOLE_ERRORS:', JSON.stringify(consoleErrors));

  await browser.close();
})();

import { expect, test } from '@playwright/test';

/**
 * Smoke: the app boots in a real browser and gets as far as a usable login
 * screen with no API behind it.
 *
 * That last part is the interesting bit rather than an accident of the setup.
 * BrandConfigService fetches /config/branding during bootstrap and is written
 * to resolve on defaults if the request fails, precisely so a misconfigured or
 * briefly unreachable API cannot take the whole frontend down. If that
 * contract ever breaks, bootstrap hangs or rejects and this spec fails —
 * which is more than "the page rendered".
 */
test.describe('App shell', () => {
  test('serves the login screen on defaults with no API available', async ({ page }) => {
    const response = await page.goto('/login');
    expect(response?.status()).toBe(200);

    // The email form is the sentinel for "routing, the lazy route chunk and the
    // component tree all resolved". It used to be the Google button, which
    // stopped working as one in v2-8: a community offers a social provider only
    // where it has registered its own OAuth app, and on defaults it has none —
    // so the absence of that button is now correct behaviour rather than a
    // broken bootstrap. Email/password is the right sentinel because it is the
    // one method that is always available, on every community, with no
    // configuration.
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  });

  // The other half of the v2-8 rule, and the reason the assertion above changed:
  // offering a provider the community cannot actually complete a sign-in with
  // would send a member to a consent screen and fail them afterwards.
  test('offers no social sign-in when branding resolves on defaults', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();

    await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue with Facebook' })).toHaveCount(0);
  });

  test('redirects an unauthenticated visitor away from a guarded route', async ({ page }) => {
    await page.goto('/profile');

    // authGuard sends anonymous traffic to /login rather than rendering an
    // empty shell or erroring.
    await expect(page).toHaveURL(/\/login/);
  });
});

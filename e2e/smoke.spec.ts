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

    // Rendered by Angular Material after bootstrap completes, so its presence
    // means routing, the lazy route chunk and the component tree all resolved.
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  });

  test('redirects an unauthenticated visitor away from a guarded route', async ({ page }) => {
    await page.goto('/profile');

    // authGuard sends anonymous traffic to /login rather than rendering an
    // empty shell or erroring.
    await expect(page).toHaveURL(/\/login/);
  });
});

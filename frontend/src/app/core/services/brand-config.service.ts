import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';

export interface BrandConfig {
  name: string;
  tagline: string;
  colorPrimary: string;
  colorAccent: string;
  colorBackground: string;
  logoUrl: string;
  splashUrl: string;
  iconUrl: string;
}

// Compiled-in default assets a fresh fork ships with. Used whenever the
// matching app_config image URL is empty (no admin upload yet). A fork can
// override either by uploading in /admin/settings or by swapping these
// static files in public/ before building.
const DEFAULT_LOGO = 'assets/logo.png';
const DEFAULT_SPLASH = 'images/dinnerbears-splash.png';
const DEFAULT_ICON = 'images/DinnerBearsIcon.png';

// Mirrors the live styles.scss palette / api-side SITE_SETTING_DEFAULTS —
// what renders before the branding fetch resolves, and what stays in place
// if it fails, so a network hiccup never blocks the app shell on branding.
// Image URLs start empty so the compiled-in default assets show through.
const DEFAULT_BRAND: BrandConfig = {
  name: 'DinnerBears',
  tagline: 'Good food. Great company. Bear memories.',
  colorPrimary: '#C9933A',
  colorAccent: '#C9933A',
  colorBackground: '#FDFAF5',
  logoUrl: '',
  splashUrl: '',
  iconUrl: '',
};

// Loaded once via provideAppInitializer (see app.config.ts), same pattern
// as AuthService.init(). Colors are applied as CSS custom-property
// overrides so every component already using var(--db-primary) etc. picks
// up a fork's theme with no rebuild — see styles.scss for the full
// variable set this deliberately does NOT touch (derived/hover shades
// like --db-primary-dark stay fixed; only the three core brand colors are
// configurable for now). Logo/splash/icon images follow the same pattern:
// an admin-uploaded URL overrides the compiled-in default asset.
@Injectable({ providedIn: 'root' })
export class BrandConfigService {
  private readonly http = inject(HttpClient);
  private readonly titleService = inject(Title);
  readonly brand = signal<BrandConfig>(DEFAULT_BRAND);

  // Resolved image sources: the admin-uploaded URL if set, else the
  // compiled-in default. Components bind [src] to these so a fork's uploaded
  // images flow everywhere with no per-component fallback logic.
  readonly logoSrc = computed(() => this.brand().logoUrl || DEFAULT_LOGO);
  readonly splashSrc = computed(() => this.brand().splashUrl || DEFAULT_SPLASH);
  readonly iconSrc = computed(() => this.brand().iconUrl || DEFAULT_ICON);

  async init(): Promise<void> {
    try {
      const config = await firstValueFrom(this.http.get<BrandConfig>('/api/v1/config/branding'));
      this.brand.set(config);
      this.applyColors(config);
      this.applyFavicon(config.iconUrl || DEFAULT_ICON);
      // index.html's static <title> is what search engines/the initial tab
      // title show — this only updates the *live* tab title once Angular
      // has booted. Per-route titles (if ever added) would override this.
      this.titleService.setTitle(config.name);
    } catch {
      // Keep the built-in default — styles.scss already renders it, so a
      // failed fetch here is a no-op, not a broken page.
    }
  }

  // Called by the admin settings screen after an upload/reset so the current
  // session reflects the change immediately without a reload.
  async refresh(): Promise<void> {
    await this.init();
  }

  private applyColors(config: BrandConfig): void {
    const root = document.documentElement.style;
    root.setProperty('--db-primary', config.colorPrimary);
    root.setProperty('--db-amber', config.colorPrimary);
    root.setProperty('--db-accent', config.colorAccent);
    root.setProperty('--db-cream', config.colorBackground);

    // Angular Material's M3 component styles fall back to these --mat-sys-*
    // system tokens internally (see styles.scss's mat.theme() call) — this
    // is what makes color="primary"/"accent" Material components (buttons,
    // toggles, checkboxes, form-field focus states, etc.) follow the admin's
    // chosen colors too, not just elements hand-styled with var(--db-*).
    // "on-*" text/icon colors are fixed to white rather than recomputed —
    // an admin choosing a very light primary/accent color will get low
    // contrast until per-color contrast computation is built.
    root.setProperty('--mat-sys-primary', config.colorPrimary);
    root.setProperty('--mat-sys-on-primary', '#ffffff');
    // Material's M2-compatibility layer maps color="accent" to M3's
    // "tertiary" system color, not "secondary".
    root.setProperty('--mat-sys-tertiary', config.colorAccent);
    root.setProperty('--mat-sys-on-tertiary', '#ffffff');
  }

  // Swaps the live favicon + apple-touch-icon <link>s. index.html's static
  // ones are what a cold load / crawler sees; this only updates the running
  // tab. The PWA manifest's icons are static and can't be changed at runtime
  // — a fork wanting a fully-branded installed-PWA icon must also swap the
  // files referenced by public/manifest.webmanifest and rebuild.
  private applyFavicon(url: string): void {
    const links = document.querySelectorAll<HTMLLinkElement>(
      'link[rel="icon"], link[rel="apple-touch-icon"]',
    );
    links.forEach((link) => (link.href = url));
  }
}

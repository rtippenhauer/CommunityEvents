import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';

export interface BrandConfig {
  name: string;
  tagline: string;
  colorPrimary: string;
  colorAccent: string;
  colorBackground: string;
}

// Mirrors the live styles.scss palette / api-side SITE_SETTING_DEFAULTS —
// what renders before the branding fetch resolves, and what stays in place
// if it fails, so a network hiccup never blocks the app shell on branding.
const DEFAULT_BRAND: BrandConfig = {
  name: 'DinnerBears',
  tagline: 'Good food. Great company. Bear memories.',
  colorPrimary: '#C9933A',
  colorAccent: '#C9933A',
  colorBackground: '#FDFAF5',
};

// Loaded once via provideAppInitializer (see app.config.ts), same pattern
// as AuthService.init(). Colors are applied as CSS custom-property
// overrides so every component already using var(--db-primary) etc. picks
// up a fork's theme with no rebuild — see styles.scss for the full
// variable set this deliberately does NOT touch (derived/hover shades
// like --db-primary-dark stay fixed; only the three core brand colors are
// configurable for now).
@Injectable({ providedIn: 'root' })
export class BrandConfigService {
  private readonly http = inject(HttpClient);
  private readonly titleService = inject(Title);
  readonly brand = signal<BrandConfig>(DEFAULT_BRAND);

  async init(): Promise<void> {
    try {
      const config = await firstValueFrom(this.http.get<BrandConfig>('/api/v1/config/branding'));
      this.brand.set(config);
      this.applyColors(config);
      // index.html's static <title> is what search engines/the initial tab
      // title show — this only updates the *live* tab title once Angular
      // has booted. Per-route titles (if ever added) would override this.
      this.titleService.setTitle(config.name);
    } catch {
      // Keep the built-in default — styles.scss already renders it, so a
      // failed fetch here is a no-op, not a broken page.
    }
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
}

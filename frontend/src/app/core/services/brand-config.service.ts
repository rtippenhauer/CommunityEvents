import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { reshade, darkenBy } from '../utils/color.util';
import { wordmarkDataUri, splashDataUri, monogramDataUri } from '../utils/brand-mark.util';

/** The social sign-ins a community offers. See BrandConfig.authProviders. */
export interface AuthProviders {
  google: boolean;
  facebook: boolean;
}

export interface BrandConfig {
  name: string;
  tagline: string;
  colorPrimary: string;
  colorAccent: string;
  colorBackground: string;
  logoUrl: string;
  splashUrl: string;
  iconUrl: string;
  storyUrl: string;
  // Per-instance values that used to be compiled into the frontend bundle
  // (environment.*.ts). Now served from this instance's .env via
  // /config/branding so one generic image serves any instance.
  vapidPublicKey: string | null;
  facebookAppId: string | null;
  /**
   * Which social sign-ins this community offers (REQ-TENANT-01.9).
   *
   * A community registers its own OAuth apps or offers none; there is no
   * deployment-wide app to fall back to, so a button shown without credentials
   * behind it is a button that fails after the member has already left for a
   * consent screen. Email/password is absent because it is always available.
   */
  authProviders: AuthProviders;
  isStage: boolean;
  appUrl: string;
  baseDomain: string;
  /** Whether this community is the root one (REQ-TENANT-01.7). */
  isRoot: boolean;
  /**
   * Where a member is told to write for help. Resolved per community by the
   * API; the pages that surface it used to hardcode support@dinnerbears.com,
   * which no other community could receive mail at.
   */
  supportEmail: string;
  /**
   * What this community calls its founding achievement, read from its own
   * catalogue row rather than guessed from the brand name.
   */
  foundingLabel: string;
  /**
   * Whether a human has confirmed this community's Terms and Privacy Policy.
   * Every community is seeded with the platform's templates so its legal pages
   * are never blank; this says somebody has since read them.
   */
  legalReviewed: boolean;
  // Per-instance terminology (Phase 32). Singular + plural kept separate so a
  // fork can rename e.g. Restaurant→Location, Dinner→Meeting without unreliable
  // auto-pluralization; points is a single label.
  terms: BrandTerms;
  // Per-instance feature toggles (Phase 33). All default true; a fork turns
  // features off in /admin/settings. The nav hides disabled items and a route
  // guard blocks direct navigation — but the API is the real enforcement.
  features: BrandFeatures;
}

export interface BrandTerms {
  locationSingular: string;
  locationPlural: string;
  dinnerSingular: string;
  dinnerPlural: string;
  points: string;
}

export interface BrandFeatures {
  ratings: boolean;
  ratingsResidences: boolean;
  leaderboard: boolean;
  merch: boolean;
  members: boolean;
  requireMembership: boolean;
}

// Default assets for a community that has uploaded none (v2-10). These used to
// be three checked-in DinnerBears PNGs; they are now drawn at runtime from the
// community's own name and palette by brand-mark.util.ts.
//
// The change is not cosmetic. A compiled-in image is one file for the whole
// deployment, but what it stands in for is a single community's identity — so
// every community that had not uploaded a logo wore DinnerBears' bear, and
// swapping in a CommunityEvents PNG would only have changed whose. A generated
// mark says the community's own name, which is the only answer that is right
// for all of them. It also drops ~13MB of PNGs from the bundle.
//
// An admin upload still overrides by the same plain string substitution as
// before: these are URLs, so nothing downstream of `logoSrc` had to change.
const defaultLogo = (b: BrandConfig): string =>
  wordmarkDataUri(b.name, { primary: b.colorPrimary, background: b.colorBackground });
const defaultSplash = (b: BrandConfig): string =>
  splashDataUri(b.name, b.tagline, { primary: b.colorPrimary, background: b.colorBackground });
const defaultIcon = (b: BrandConfig): string =>
  monogramDataUri(b.name, { primary: b.colorPrimary, background: b.colorBackground });

// Mirrors the live styles.scss palette / api-side SITE_SETTING_DEFAULTS —
// what renders before the branding fetch resolves, and what stays in place
// if it fails, so a network hiccup never blocks the app shell on branding.
// Image URLs start empty so the compiled-in default assets show through.
const DEFAULT_BRAND: BrandConfig = {
  // Must match SITE_SETTING_DEFAULTS.brand_name on the API, for the same
  // reason the settings form must (see dad8b50): two defaults that disagree
  // show one name while the app uses another.
  name: 'CommunityEvents',
  tagline: 'Good food. Great company.',
  colorPrimary: '#C9933A',
  colorAccent: '#C9933A',
  colorBackground: '#FDFAF5',
  logoUrl: '',
  splashUrl: '',
  iconUrl: '',
  storyUrl: '',
  // Null/empty until the branding fetch resolves. A network hiccup leaves push
  // and Facebook login disabled (feature-detected off a null key) rather than
  // crashing the shell — the same graceful-degradation the old baked-in
  // `null` defaults gave.
  vapidPublicKey: null,
  facebookAppId: null,
  // Defaults off, like isRoot and for the same reason: until branding loads we
  // do not know what this community offers, and offering nothing briefly is
  // better than offering a button that cannot work.
  authProviders: { google: false, facebook: false },
  isStage: false,
  // Empty until branding resolves. The pages that use it hide the mailto rather
  // than render a broken one, the same way storyImageUrl hides its image.
  supportEmail: '',
  // The platform default until branding resolves. Unlike the old brand-name
  // comparison this is only a placeholder for one request, not a rule.
  foundingLabel: 'Founding Member',
  appUrl: '',
  baseDomain: '',
  // Defaults false: until branding loads, assume this is NOT the root
  // community, so nothing root-only is offered on a guess.
  isRoot: false,
  // Defaults true, unlike isRoot: this one drives a warning banner, and a slow
  // or failed branding fetch should not accuse a community of skipping a review
  // it may well have done.
  legalReviewed: true,
  // The generic platform wording, not DinnerBears' — these mirror the API's
  // SITE_SETTING_DEFAULTS terms (now term-defaults.ts) and are what shows until
  // branding resolves. A community renames them in Site Settings.
  terms: {
    locationSingular: 'Location',
    locationPlural: 'Locations',
    dinnerSingular: 'Event',
    dinnerPlural: 'Events',
    points: 'Points',
  },
  // Everything enabled until branding resolves — matches the API defaults, so
  // a slow/failed fetch never hides a feature that's actually on. Two
  // exceptions, both mirroring an off-by-default API value so the fallback
  // never enables something the server would refuse: requireMembership (a
  // brand-new concept nothing depends on — a failed fetch should never
  // suddenly start enforcing membership) and ratingsResidences (Phase 37 —
  // offering a rating form the API answers with a 403 is worse than briefly
  // hiding one).
  features: {
    ratings: true,
    ratingsResidences: false,
    leaderboard: true,
    merch: true,
    members: true,
    requireMembership: false,
  },
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
  readonly logoSrc = computed(() => this.brand().logoUrl || defaultLogo(this.brand()));
  readonly splashSrc = computed(() => this.brand().splashUrl || defaultSplash(this.brand()));
  readonly iconSrc = computed(() => this.brand().iconUrl || defaultIcon(this.brand()));
  // No compiled-in fallback: empty means the home-page story image is hidden.
  readonly storyImageUrl = computed(() => this.brand().storyUrl);

  // Per-instance runtime values (formerly environment.*.ts). Read as signals so
  // callers stay reactive if branding is ever refreshed mid-session.
  readonly vapidPublicKey = computed(() => this.brand().vapidPublicKey);
  readonly facebookAppId = computed(() => this.brand().facebookAppId);
  readonly authProviders = computed(() => this.brand().authProviders);
  readonly offersGoogle = computed(() => this.brand().authProviders.google);
  readonly offersFacebook = computed(() => this.brand().authProviders.facebook);
  readonly isStage = computed(() => this.brand().isStage);
  readonly appUrl = computed(() => this.brand().appUrl);
  readonly baseDomain = computed(() => this.brand().baseDomain);
  readonly isRoot = computed(() => this.brand().isRoot);
  readonly supportEmail = computed(() => this.brand().supportEmail);
  readonly foundingLabel = computed(() => this.brand().foundingLabel);
  readonly legalReviewed = computed(() => this.brand().legalReviewed);

  // Configurable terminology (Phase 32). Components bind these instead of
  // hardcoding "Restaurant"/"Dinner"/"Bear Points". Title-cased as stored;
  // use the *Lower variants for mid-sentence copy ("attend a dinner").
  readonly terms = computed(() => this.brand().terms);
  readonly locationSingular = computed(() => this.terms().locationSingular);
  readonly locationPlural = computed(() => this.terms().locationPlural);
  readonly dinnerSingular = computed(() => this.terms().dinnerSingular);
  readonly dinnerPlural = computed(() => this.terms().dinnerPlural);
  readonly points = computed(() => this.terms().points);
  readonly locationSingularLower = computed(() => this.locationSingular().toLowerCase());
  readonly locationPluralLower = computed(() => this.locationPlural().toLowerCase());
  readonly dinnerSingularLower = computed(() => this.dinnerSingular().toLowerCase());
  readonly dinnerPluralLower = computed(() => this.dinnerPlural().toLowerCase());

  // Per-instance feature toggles (Phase 33). Nav items bind these to hide
  // disabled features; a functional route guard reads the same signals. The
  // server still enforces via @RequireFeature, so hiding is UX, not security.
  readonly features = computed(() => this.brand().features);
  readonly ratingsEnabled = computed(() => this.features().ratings);
  readonly ratingsResidencesEnabled = computed(() => this.features().ratingsResidences);
  readonly leaderboardEnabled = computed(() => this.features().leaderboard);
  readonly merchEnabled = computed(() => this.features().merch);
  readonly membersEnabled = computed(() => this.features().members);
  // Membership fee (Phase 35) — unlike the others above, this is not just a
  // nav/route gate: the server enforces the actual RSVP block in upsertRsvp.
  // This signal drives the admin-settings toggle and admin-users' membership
  // column/edit UI visibility.
  readonly requireMembershipEnabled = computed(() => this.features().requireMembership);

  // Founding-achievement label, served per community (v2-10).
  //
  // This used to compare brand_name against the literal 'dinnerbears' and pick
  // one of two hardcoded strings. That was a guess standing in for data that did
  // not exist: the achievement catalogue was global, so there was no
  // per-community badge to read. Scoping it made the row the community's own, so
  // the API now reports whatever that row is actually called and a community
  // that renames its badge sees the new name in the surrounding UI (merch gate,
  // achievement category headers) rather than one derived from its brand.
  // Append "s" for the plural.

  async init(): Promise<void> {
    try {
      const config = await firstValueFrom(this.http.get<BrandConfig>('/api/v1/config/branding'));
      this.brand.set(config);
      this.applyColors(config);
      this.applyFavicon(config.iconUrl || defaultIcon(config));
      // index.html's static <title> is what search engines/the initial tab
      // title show — this only updates the *live* tab title once Angular
      // has booted. Per-route titles (if ever added) would override this.
      // Stage instances get a " (Stage)" suffix so the tab stays distinguishable
      // from prod now that there's no separate stage build/index.html.
      this.titleService.setTitle(config.isStage ? `${config.name} (Stage)` : config.name);
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

    this.applyChrome(config.colorPrimary, config.colorBackground);
  }

  // Derive the dark "chrome" palette (toolbar, sidenav, footer, stage banner,
  // hover shades) from the single configured primary + background, so a fork
  // gets a coherent dark UI in its own hue instead of DinnerBears' hardcoded
  // browns. styles.scss keeps the browns as the compiled-in fallback for the
  // pre-JS paint; these runtime values override them once branding loads.
  // Absolute target lightness values are chosen to sit near DinnerBears'
  // original hand-picked browns when primary is the amber default — a
  // different brand hue (e.g. Sons' green) yields the equivalent dark tones in
  // that hue. Saturation is forced up for the darkest tones so they read as a
  // rich shade of the brand rather than muddy near-black.
  private applyChrome(primary: string, background: string): void {
    const root = document.documentElement.style;
    // Dark brown/chrome family — target lightness, boosted saturation.
    root.setProperty('--db-brown', reshade(primary, 9, 80));
    root.setProperty('--db-brown-dark', reshade(primary, 13, 80));
    root.setProperty('--db-brown-nav', reshade(primary, 13, 80));
    root.setProperty('--db-brown-card', reshade(primary, 16, 80));
    root.setProperty('--db-brown-mid', reshade(primary, 24, 85));
    // Stage banner — a saturated mid-dark shade of the brand.
    root.setProperty('--db-banner', reshade(primary, 35, 90));
    // Hover shades of the primary (keep the brand's own saturation).
    root.setProperty('--db-primary-dark', reshade(primary, 37));
    root.setProperty('--db-amber-dark', reshade(primary, 37));
    // Accent for text/marks sitting ON the dark chrome (stats strip, story
    // section). The raw primary works on light backgrounds, but a *dark* brand
    // color (e.g. Sons' green) has almost no contrast against its own derived
    // dark-chrome shade — so use a lightened tint here instead.
    root.setProperty('--db-accent-on-dark', reshade(primary, 66));
    // Muted secondary-text-on-dark tone: a light, desaturated brand tint.
    root.setProperty('--db-cream-muted', reshade(primary, 65, 38));
    // Slightly darker cream, derived from the background (the inset nav band).
    root.setProperty('--db-cream-dark', darkenBy(background, 8));
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

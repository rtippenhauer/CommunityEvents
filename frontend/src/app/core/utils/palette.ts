// The palette: three seeds in, every colour token out.
//
// This is deliberately pure and DOM-free. BrandConfigService writes the result
// to the document, and the admin colour screen renders the same result as a
// preview without touching the running page — one derivation, so what an admin
// previews is exactly what they get. Before v2-11 the derivation lived inside
// BrandConfigService and wrote straight to `document.documentElement.style`,
// which meant a preview could only be built by mutating the live page and
// putting it back afterwards.
//
// Fonts and the semantic colours (success/error) are not here: fonts are not
// colours, and red-means-error is not a branding choice. They stay as literals
// in styles.scss.

import {
  reshade,
  darkenBy,
  onColorFor,
  onColorForAll,
  readableOn,
  contrastRatio,
  ON_DARK,
  AA_NORMAL,
  AA_LARGE,
} from './color.util';

/** What an admin actually chooses. Everything else follows from these. */
export interface PaletteSeeds {
  primary: string;
  accent: string;
  background: string;
}

/**
 * Every derived colour token, in the order the admin screen lists them.
 *
 * Exhaustive on purpose: `derivePalette` returns a `Record` keyed by this
 * union, so adding a token here without deriving it fails the build rather
 * than shipping a token that silently resolves to nothing.
 */
export const PALETTE_TOKENS = [
  '--ce-primary',
  '--ce-on-primary',
  '--ce-primary-hover',
  '--ce-accent',
  '--ce-on-accent',
  '--ce-accent-on-chrome',
  '--ce-on-brand-blend',
  '--ce-surface',
  '--ce-surface-variant',
  '--ce-text',
  '--ce-text-muted',
  '--ce-chrome',
  '--ce-chrome-deep',
  '--ce-chrome-raised',
  '--ce-chrome-soft',
  '--ce-on-chrome',
  '--ce-on-chrome-muted',
  '--ce-banner',
  '--ce-on-banner',
] as const;

export type PaletteToken = (typeof PALETTE_TOKENS)[number];
export type Palette = Record<PaletteToken, string>;

/** A per-token override. Absent or blank means "use the derived value". */
export type PaletteOverrides = Partial<Record<PaletteToken, string>>;

function isPaletteToken(key: string): key is PaletteToken {
  return (PALETTE_TOKENS as readonly string[]).includes(key);
}

/**
 * Derive the full token set from the three seeds.
 *
 * The absolute lightness targets are the ones v2-10 chose so that the seeded
 * amber reproduces the palette this app was hand-built in — which is what
 * makes the whole system invisible to a community that has not touched its
 * colours, and correct for one that has. Don't retune them casually.
 */
export function derivePalette(seeds: PaletteSeeds): Palette {
  const { primary, accent, background } = seeds;

  // The chrome family: the brand hue at fixed dark lightnesses, saturation
  // pushed up so the darkest tones read as a rich shade of the brand rather
  // than muddy near-black.
  const chrome = reshade(primary, 13, 80);
  const banner = reshade(primary, 35, 90);

  return {
    '--ce-primary': primary,
    '--ce-on-primary': onColorFor(primary),
    '--ce-primary-hover': reshade(primary, 37),

    '--ce-accent': accent,
    '--ce-on-accent': onColorFor(accent),
    // The raw primary reads fine on a light ground but a *dark* brand colour
    // has almost no contrast against its own derived chrome, so this is a
    // lightened tint — and only while that tint stays legible.
    '--ce-accent-on-chrome': readableOn(chrome, reshade(primary, 66), true),
    // For a surface painted with both at once (a gradient), measured against
    // both stops: a label is unreadable wherever it is worst, not on average.
    '--ce-on-brand-blend': onColorForAll([primary, accent]),

    '--ce-surface': background,
    // Steps *away* from the ground rather than always darker: on a dark ground
    // a darker inset disappears into it.
    '--ce-surface-variant': darkenBy(background, onColorFor(background) === ON_DARK ? -8 : 8),
    // Ink prefers a warm brand-tinted tone and falls back to the measured
    // floor only where that tone stops being readable on this ground.
    '--ce-text': readableOn(background, reshade(primary, 16, 45)),
    '--ce-text-muted': readableOn(background, reshade(primary, 32, 30)),

    '--ce-chrome': chrome,
    '--ce-chrome-deep': reshade(primary, 9, 80),
    '--ce-chrome-raised': reshade(primary, 16, 80),
    '--ce-chrome-soft': reshade(primary, 24, 85),
    '--ce-on-chrome': onColorFor(chrome),
    '--ce-on-chrome-muted': readableOn(chrome, reshade(primary, 65, 38)),

    '--ce-banner': banner,
    '--ce-on-banner': onColorFor(banner),
  };
}

/**
 * Lay an admin's per-token overrides over a derived palette.
 *
 * Overrides are stored separately from the seeds and applied at read time,
 * never materialised into a flat saved palette. That is the whole reason the
 * storage is shaped `{ seeds, overrides }`: flattening would make a later seed
 * change either silently discard an override or silently keep a stale one, and
 * an admin would have no way to tell which. Same pattern as the legal
 * templates, which interpolate on the public read rather than at seed time.
 *
 * Unknown keys and blank values are ignored rather than rejected, so a payload
 * written by an older or newer version cannot break the page's colours.
 */
export function applyOverrides(derived: Palette, overrides: PaletteOverrides): Palette {
  const out = { ...derived };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (isPaletteToken(key) && typeof value === 'string' && value.trim()) {
      out[key] = value.trim();
    }
  }
  return out;
}

/** Seeds -> derived -> overridden, the single path both the app and the preview take. */
export function resolvePalette(seeds: PaletteSeeds, overrides: PaletteOverrides = {}): Palette {
  return applyOverrides(derivePalette(seeds), overrides);
}

/**
 * Parse the stored overrides blob.
 *
 * Stored as JSON text in one `app_config` row rather than a row per token: the
 * set of tokens is ours and changes with the code, so a column per token would
 * need a migration every time the palette grows. Anything unparseable resolves
 * to "no overrides", because a corrupt blob must not be able to take the app's
 * colours down.
 */
export function parseOverrides(raw: string | null | undefined): PaletteOverrides {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: PaletteOverrides = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isPaletteToken(key) && typeof value === 'string' && value.trim()) {
        out[key] = value.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

// ── Contrast warnings ──────────────────────────────────────────────────────
// The screen warns, it never blocks. An admin who insists on a low-contrast
// pair should be told what it does to their members, not silently obeyed and
// not silently overruled. Blocking would also be wrong on its own terms: some
// pairs cannot reach AA at all (a gradient spanning the luminance crossover
// tops out near 1.4:1), so a blocking rule would make legitimate palettes
// unsaveable rather than merely flagged.

export interface ContrastWarning {
  /**
   * `contrast` is a measured pair that falls short. `unsupported` is a choice
   * the app cannot render at all, whatever its ratios say -- a different thing
   * and worth showing differently.
   */
  kind: 'contrast' | 'unsupported';
  /** The token whose colour is at fault, so the screen can point at a field. */
  token: PaletteToken;
  /** Human-readable description of what is unreadable. */
  message: string;
  /** Measured ratio, rounded to one decimal. */
  ratio: number;
  /** The threshold it failed: 4.5 for body text, 3 for large text. */
  required: number;
}

/** What sits on what, and whether the text counts as "large" for WCAG. */
const CONTRAST_PAIRS: ReadonlyArray<{
  fg: PaletteToken;
  bg: PaletteToken;
  large?: boolean;
  what: string;
}> = [
  { fg: '--ce-on-primary', bg: '--ce-primary', what: 'Text on primary buttons' },
  { fg: '--ce-on-accent', bg: '--ce-accent', what: 'Text on accent surfaces' },
  { fg: '--ce-text', bg: '--ce-surface', what: 'Body text on the page' },
  { fg: '--ce-text-muted', bg: '--ce-surface', what: 'Secondary text on the page' },
  { fg: '--ce-on-chrome', bg: '--ce-chrome', what: 'Nav and footer text' },
  { fg: '--ce-on-chrome-muted', bg: '--ce-chrome', what: 'Secondary text in the nav and footer' },
  { fg: '--ce-on-banner', bg: '--ce-banner', what: 'Text on the environment banner' },
  {
    fg: '--ce-accent-on-chrome',
    bg: '--ce-chrome',
    large: true,
    what: 'Accent headings on the dark chrome',
  },
  { fg: '--ce-on-brand-blend', bg: '--ce-primary', what: 'Text over a primary/accent blend' },
  { fg: '--ce-on-brand-blend', bg: '--ce-accent', what: 'Text over a primary/accent blend' },
];

/**
 * Every pair in the palette that fails WCAG AA, worst first.
 *
 * Reports the *foreground* token, because that is the one an admin can change
 * to fix it — telling them their primary is wrong when the fix is the label
 * colour sends them to the wrong field.
 */
export function contrastWarnings(palette: Palette): ContrastWarning[] {
  const out: ContrastWarning[] = [];

  // A dark page background is not supported yet, and the failure is ugly: the
  // ink derives correctly as near-white while Angular Material's surfaces stay
  // light (styles.scss compiles `theme-type: light`, and nothing overrides the
  // --mat-sys-surface family), so body copy lands white-on-cream. 145 hardcoded
  // light backgrounds across 27 components say the same thing.
  //
  // Detected by asking whether white wins on this ground rather than by a
  // lightness threshold -- that is exactly the condition under which the
  // derived ink flips to light and stops matching the surfaces it sits on.
  if (onColorFor(palette['--ce-surface']) === ON_DARK) {
    out.push({
      kind: 'unsupported',
      token: '--ce-surface',
      message:
        'A dark page background is not supported yet — cards and menus stay light, so body text ' +
        'becomes unreadable. Choose a light background.',
      ratio: 0,
      required: AA_NORMAL,
    });
  }
  for (const pair of CONTRAST_PAIRS) {
    const required = pair.large ? AA_LARGE : AA_NORMAL;
    const ratio = contrastRatio(palette[pair.fg], palette[pair.bg]);
    if (ratio === null) {
      out.push({
        kind: 'contrast',
        token: pair.fg,
        message: `${pair.what}: one of these is not a valid colour.`,
        ratio: 0,
        required,
      });
      continue;
    }
    if (ratio < required) {
      out.push({
        kind: 'contrast',
        token: pair.fg,
        message: `${pair.what} is hard to read (${ratio.toFixed(1)}:1, needs ${required}:1).`,
        ratio: Math.round(ratio * 10) / 10,
        required,
      });
    }
  }
  return out.sort((a, b) => a.ratio - b.ratio);
}


// ── Angular Material surfaces ──────────────────────────────────────────────

/**
 * Material's `--mat-sys-*` surface family, derived from the palette.
 *
 * Without this every card, menu, dialog and sheet in the app is whatever
 * `mat.theme()` baked at build time — and `styles.scss` seeds that with
 * `mat.$orange-palette`, which M3 uses to tint its *neutrals*. So an indigo
 * community got amber-tinted cream cards on a cool near-white page, with no
 * setting anywhere that could change them. Found on stage by Rob, who noticed
 * there was no config value for the colour he was looking at. There wasn't.
 *
 * v2-11 previously set four Material tokens (primary/on-primary/tertiary/
 * on-tertiary), which coloured the *controls* and left the surfaces behind
 * them alone. This closes that.
 *
 * The container ramp steps away from the ground rather than always darker,
 * because Material's own convention inverts between light and dark themes: a
 * raised surface is darker than a light page and lighter than a dark one.
 */
export function materialSurfaceTokens(palette: Palette): Record<string, string> {
  const surface = palette['--ce-surface'];
  const onDarkGround = onColorFor(surface) === ON_DARK;
  const step = (points: number): string => darkenBy(surface, onDarkGround ? -points : points);

  return {
    '--mat-sys-background': surface,
    '--mat-sys-on-background': palette['--ce-text'],
    '--mat-sys-surface': surface,
    '--mat-sys-on-surface': palette['--ce-text'],
    '--mat-sys-surface-bright': step(-2),
    '--mat-sys-surface-dim': step(6),
    '--mat-sys-surface-container-lowest': step(-1),
    '--mat-sys-surface-container-low': step(2),
    '--mat-sys-surface-container': step(4),
    '--mat-sys-surface-container-high': step(6),
    '--mat-sys-surface-container-highest': step(8),
    '--mat-sys-surface-variant': palette['--ce-surface-variant'],
    '--mat-sys-on-surface-variant': palette['--ce-text-muted'],
    // Borders and rules: far enough from the ground to be visible, not so far
    // they read as text.
    '--mat-sys-outline': step(35),
    '--mat-sys-outline-variant': step(14),
  };
}

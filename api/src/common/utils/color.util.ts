/**
 * Hex <-> HSL helpers for deriving an email palette from a community's single
 * configured brand colour (v2-10).
 *
 * Mirrors `frontend/src/app/core/utils/color.util.ts`, the same way
 * `roles.util.ts` is mirrored across the two workspaces. The frontend uses its
 * copy in `BrandConfigService.applyChrome` to build the app's dark chrome from
 * the primary; this copy exists so transactional email can derive *the same*
 * shades. Email cannot use CSS custom properties -- every colour has to be a
 * literal in the markup at send time -- so the derivation has to happen here.
 *
 * Keep the two in step. The absolute lightness targets below are chosen so that
 * an amber primary reproduces the palette these templates were hand-written in,
 * which is what makes the change invisible for a community that has not
 * touched its colours and correct for one that has.
 *
 * Deliberately dependency-free and clamped, so any admin-chosen hex yields a
 * valid result rather than throwing inside an email send.
 */

export interface Hsl {
  h: number; // 0..360
  s: number; // 0..100
  l: number; // 0..100
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/** Parse #rgb or #rrggbb (with or without leading #). Returns null if unparseable. */
/** Normalise `#rgb`, `#rrggbb` or a bare `rrggbb` to six lower-case digits. */
function normalizeHex(hex: string): string | null {
  let h = (hex ?? '').trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  return /^[0-9a-fA-F]{6}$/.test(h) ? h.toLowerCase() : null;
}

/** Parse a hex colour to 0..255 channels. Returns null if unparseable. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = normalizeHex(hex);
  if (!h) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function hexToHsl(hex: string): Hsl | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  let s = 0;
  let hue = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        hue = ((g - b) / delta) % 6;
        break;
      case g:
        hue = (b - r) / delta + 2;
        break;
      default:
        hue = (r - g) / delta + 4;
    }
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  return { h: hue, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const sN = clamp(s, 0, 100) / 100;
  const lN = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const toHex = (v: number): string =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Re-shade `hex` to an absolute target lightness, optionally overriding
 * saturation. Hue is preserved, so the result stays recognisably "the brand
 * colour, darker/lighter". Returns `hex` unchanged if it cannot be parsed --
 * an unparseable value should degrade to the admin's literal input rather than
 * abort a send.
 */
export function reshade(hex: string, targetL: number, targetS?: number): string {
  const hsl = hexToHsl(hex);
  if (!hsl) return hex;
  return hslToHex({ h: hsl.h, s: targetS ?? hsl.s, l: targetL });
}

// ── Contrast ───────────────────────────────────────────────────────────────
// Every `on-` colour in the palette is chosen by measurement rather than
// assumed. Before v2-11 both `--mat-sys-on-primary` and `--mat-sys-on-tertiary`
// were pinned to white, so a community picking a light primary got white text
// on a pale button -- a defect the admin could see but not fix, since the
// on-colour was not exposed as a setting.

/**
 * The two candidates every `on-` colour is chosen between.
 *
 * `ON_LIGHT` is pure black deliberately, against the usual advice to soften it.
 * Swept over the whole HSL cube (5 degree hue x 10% saturation x 5% lightness),
 * the worst achievable contrast is 4.584:1 with `#000000` and 4.173:1 with
 * `#1a1a1a` -- so black clears AA for *every* colour an admin can pick, while a
 * softened black leaves 3.7% of the cube with no legible label at all. The
 * softer value is the nicer default and the worse guarantee, and this is the
 * one place the guarantee is the point. Body copy still gets a warm brand tone
 * via `readableOn`; this pair is only the floor beneath it.
 */
export const ON_LIGHT = '#000000';
export const ON_DARK = '#ffffff';

/** WCAG AA thresholds: body text, and large text (>=24px, or >=18.66px bold). */
export const AA_NORMAL = 4.5;
export const AA_LARGE = 3;

/**
 * WCAG 2.1 relative luminance, or null if `hex` is unparseable.
 *
 * The channel linearisation and the 0.2126/0.7152/0.0722 weights are the
 * specification's own. A cheaper approximation (plain HSL lightness, say)
 * disagrees with the checkers an accessibility complaint gets filed with,
 * which would make our warnings and the auditor's report contradict.
 */
export function relativeLuminance(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/**
 * Contrast ratio between two colours: 1 for identical, 21 for black on white.
 * Null if either is unparseable -- a caller must fall back rather than treat
 * an unreadable pair as passing, which is what returning 0 or 21 would do.
 */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Whether `foreground` on `background` reaches AA. Unparseable => false. */
export function meetsAA(foreground: string, background: string, large = false): boolean {
  const ratio = contrastRatio(foreground, background);
  return ratio !== null && ratio >= (large ? AA_LARGE : AA_NORMAL);
}

/**
 * The text/icon colour to sit ON `background`: whichever candidate measures
 * the higher contrast against it.
 *
 * Falls back to `ON_DARK` on an unparseable background, matching the old
 * hardcoded white -- a colour field an admin has typed nonsense into should
 * render as it always did rather than flipping the whole UI to dark text.
 */
export function onColorFor(
  background: string,
  candidates: readonly string[] = [ON_DARK, ON_LIGHT],
): string {
  let best = ON_DARK;
  let bestRatio = -1;
  for (const candidate of candidates) {
    const ratio = contrastRatio(candidate, background);
    if (ratio !== null && ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return best;
}

/**
 * Prefer `preferred` -- normally a brand-tinted tone -- for text on
 * `background`, falling back to the measured best when it does not reach AA.
 *
 * This is the rule that lets a community keep its own warm ink instead of a
 * flat near-black, without that preference being able to produce unreadable
 * text on an unusual ground. Taste where taste is safe, measurement where it
 * is not.
 */
export function readableOn(background: string, preferred: string, large = false): string {
  return meetsAA(preferred, background, large) ? preferred : onColorFor(background);
}

/**
 * The colours a transactional email is built from, all derived from the
 * community's own primary plus its configured page background.
 *
 * The lightness targets mirror `applyChrome` in the frontend, so an email's
 * header band is the same shade as the app's nav bar for that community.
 */
export interface EmailPalette {
  /** Buttons, links, accents. The community's configured primary, as-is. */
  primary: string;
  /**
   * Label colour for a button painted `primary`. Measured, not white: an
   * email button is the one place a community's colour choice reaches a
   * member with no stylesheet to correct it, and no way to report it back.
   */
  onPrimary: string;
  /** Header band behind the logo — the dark chrome shade of the primary. */
  band: string;
  /** Headings on light surfaces. */
  ink: string;
  /** Body copy: a softer, less saturated version of `ink`. */
  inkMuted: string;
  /** The ground the message card sits on — the community's page background. */
  pageBg: string;
  /** Insets and secondary panels inside the card. */
  surfaceAlt: string;
  /** Hairlines, table rules, card borders. */
  rule: string;
}

export function emailPalette(primary: string, background: string): EmailPalette {
  return {
    primary,
    onPrimary: onColorFor(primary),
    band: reshade(primary, 13, 80),
    ink: reshade(primary, 16, 45),
    inkMuted: reshade(primary, 32, 30),
    pageBg: background,
    surfaceAlt: reshade(primary, 97, 30),
    rule: reshade(primary, 88, 25),
  };
}

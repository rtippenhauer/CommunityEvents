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
export function hexToHsl(hex: string): Hsl | null {
  let h = (hex ?? '').trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;

  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;

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
    band: reshade(primary, 13, 80),
    ink: reshade(primary, 16, 45),
    inkMuted: reshade(primary, 32, 30),
    pageBg: background,
    surfaceAlt: reshade(primary, 97, 30),
    rule: reshade(primary, 88, 25),
  };
}

// Small hex <-> HSL helpers used by BrandConfigService to derive the "chrome"
// palette (toolbar/sidenav/footer/banner) from an instance's single configured
// primary color, so a fork gets a coherent dark UI without hand-picking every
// shade. Deliberately dependency-free and clamped so any admin-chosen hex
// produces a valid result.

export interface Hsl {
  h: number; // 0..360
  s: number; // 0..100
  l: number; // 0..100
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/** Parse #rgb or #rrggbb (with or without leading #). Returns null if unparseable. */
export function hexToHsl(hex: string): Hsl | null {
  let h = hex.trim().replace(/^#/, '');
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
 * Return `hex` re-shaded to an absolute target lightness, optionally overriding
 * saturation. Hue is preserved, so the result stays recognizably "the brand
 * color, darker/lighter". Used to build the dark chrome tones from the primary.
 * If `hex` can't be parsed, `hex` is returned unchanged.
 */
export function reshade(hex: string, targetL: number, targetS?: number): string {
  const hsl = hexToHsl(hex);
  if (!hsl) return hex;
  return hslToHex({ h: hsl.h, s: targetS ?? hsl.s, l: targetL });
}

/** Darken by a relative percentage of lightness (e.g. 8 => 8 points darker). */
export function darkenBy(hex: string, deltaL: number): string {
  const hsl = hexToHsl(hex);
  if (!hsl) return hex;
  return hslToHex({ ...hsl, l: hsl.l - deltaL });
}

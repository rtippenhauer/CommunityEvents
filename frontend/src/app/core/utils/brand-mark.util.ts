// Generated brand marks (v2-10). A community that has uploaded no artwork gets
// a logo, icon and splash drawn from its OWN name and palette, rather than the
// platform's artwork or DinnerBears'.
//
// Why generated rather than a checked-in default image: the compiled-in
// fallback is a *deployment*-wide asset, but the thing it stands in for is a
// *community*'s identity. A single CommunityEvents PNG shipped as the fallback
// would put the platform's mark on every customer community that hadn't
// uploaded one -- visibly wrong in a way an unbranded shape is not. Drawing
// from `brand_name` means the fallback always says who you actually are.
//
// Why a data: URI rather than an inline <svg> component: every consumer binds
// `[src]` on an <img> (nav bar, login splash, favicon <link>, admin previews),
// and an admin-uploaded URL has to keep overriding the default by plain string
// substitution. Returning a URL keeps all of that untouched.
//
// These are deliberately dependency-free and pure so they can be unit-tested
// without a DOM, matching color.util.ts next door.

import { reshade } from './color.util';

/**
 * Fonts do NOT load inside an SVG rendered through <img> -- it is an isolated
 * document with no access to the page's stylesheets or webfonts. So the marks
 * ask for a system stack and get whatever the OS provides, which means glyph
 * widths vary by platform and cannot be measured ahead of time. `fitText`
 * below is what keeps that from overflowing.
 */
const FONT_STACK =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** Average glyph advance as a fraction of font size, for a bold sans-serif. */
const AVG_ADVANCE = 0.6;

/** XML-escape. The brand name is admin-controlled, so it is never trusted. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Wrap SVG source as a data: URI. encodeURIComponent (not base64) keeps the
 * markup readable in devtools and escapes the `#` in every hex colour, which
 * would otherwise truncate the URI at the first one.
 */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg.replace(/\s+/g, ' ').trim())}`;
}

/**
 * One or two initials for the square icon.
 *
 * Multi-word names take the first letter of the first two words ("Dayton
 * Supper Club" -> "DS"). A single word is read for internal capitals first, so
 * "CommunityEvents" -> "CE" rather than "CO"; failing that it takes its first
 * two letters. Digits count as letters so "5 Points Supper" still resolves.
 */
export function brandInitials(name: string): string {
  const cleaned = (name ?? '').trim();
  // Blank never happens in practice -- DEFAULT_BRAND.name is 'CommunityEvents'
  // and the API's SITE_SETTING_DEFAULTS matches it -- but a blank mark would be
  // a worse failure than falling back to the platform's own initials.
  if (!cleaned) return 'CE';

  const words = cleaned.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  const word = words[0] ?? cleaned;
  const capitals = word.match(/\p{Lu}/gu) ?? [];
  if (capitals.length >= 2) return (capitals[0] + capitals[1]).toUpperCase();
  return word.slice(0, 2).toUpperCase();
}

/**
 * Pick a font size that fits `text` into `maxWidth`, plus a `textLength` clamp
 * for when the platform's font turns out wider than estimated.
 *
 * The clamp is applied only when the estimate already overflows: forcing
 * `textLength` on every mark would stretch a short name across the full box and
 * squeeze a long one, so normal names are left to render at their natural width
 * and only pathological ones are compressed.
 */
function fitText(
  text: string,
  maxWidth: number,
  preferredSize: number,
): { size: number; textLength: number | null } {
  const estimatedAtPreferred = text.length * preferredSize * AVG_ADVANCE;
  if (estimatedAtPreferred <= maxWidth) {
    return { size: preferredSize, textLength: null };
  }
  // Shrink to fit, but not below a legible floor -- past that, compress glyphs.
  const fitted = maxWidth / (text.length * AVG_ADVANCE);
  const size = Math.max(fitted, preferredSize * 0.55);
  return { size, textLength: maxWidth };
}

function textLengthAttrs(textLength: number | null): string {
  return textLength === null
    ? ''
    : ` textLength="${textLength.toFixed(1)}" lengthAdjust="spacingAndGlyphs"`;
}

export interface MarkColors {
  /** The community's configured primary -- the tile and ground hue. */
  primary: string;
  /** Its configured page background -- the ink used on top of the primary. */
  background: string;
}

/**
 * Horizontal wordmark: a rounded monogram tile followed by the community name.
 * Used in the nav bar, footer and confirmation pages at 32-40px tall.
 *
 * The viewBox width grows with the name so the <img> (fixed height, auto width)
 * renders proportional to its content instead of padding short names with dead
 * space.
 */
export function wordmarkDataUri(name: string, colors: MarkColors): string {
  const label = escapeXml(name.trim() || 'CommunityEvents');
  const initials = escapeXml(brandInitials(name));

  const H = 48;
  const tile = 40;
  const gap = 12;
  const nameSize = 26;
  // Cap the name box so an absurdly long community name cannot produce a
  // 4000-unit-wide logo that renders as an unreadable sliver at 40px tall.
  const nameBox = Math.min(label.length * nameSize * AVG_ADVANCE, 420);
  const fit = fitText(label, nameBox, nameSize);
  const width = tile + gap + nameBox;

  // Ink on the light ground: the brand hue taken to near-black, so it reads as
  // a dark shade of the brand rather than a generic grey.
  const ink = reshade(colors.primary, 16, 45);

  return svgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(1)} ${H}"
         width="${width.toFixed(1)}" height="${H}" role="img" aria-label="${label}">
      <rect x="0" y="4" width="${tile}" height="${tile}" rx="10" fill="${colors.primary}"/>
      <text x="${tile / 2}" y="${H / 2 + 1}" text-anchor="middle" dominant-baseline="central"
            font-family="${FONT_STACK}" font-size="19" font-weight="700"
            fill="${colors.background}">${initials}</text>
      <text x="${tile + gap}" y="${H / 2 + 1}" dominant-baseline="central"
            font-family="${FONT_STACK}" font-size="${fit.size.toFixed(1)}" font-weight="650"
            fill="${ink}"${textLengthAttrs(fit.textLength)}>${label}</text>
    </svg>
  `);
}

/**
 * Square monogram: favicon, apple-touch-icon, PWA icon, and the compact brand
 * badge on the join and guest-RSVP pages.
 *
 * Full-bleed rather than transparent -- a favicon is composited onto whatever
 * the browser's tab strip happens to be, and a transparent mark vanishes on
 * half of them.
 */
export function monogramDataUri(name: string, colors: MarkColors): string {
  const label = escapeXml(name.trim() || 'CommunityEvents');
  const initials = escapeXml(brandInitials(name));
  const S = 64;
  // Two initials need a smaller face than one to sit inside the same tile.
  const size = initials.length > 1 ? 27 : 36;

  return svgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}"
         width="${S}" height="${S}" role="img" aria-label="${label}">
      <rect width="${S}" height="${S}" rx="14" fill="${colors.primary}"/>
      <text x="${S / 2}" y="${S / 2 + 1}" text-anchor="middle" dominant-baseline="central"
            font-family="${FONT_STACK}" font-size="${size}" font-weight="700"
            fill="${colors.background}">${initials}</text>
    </svg>
  `);
}

/**
 * Login hero. Rendered with `object-fit: cover` into a panel that is tall on
 * desktop and short and wide on mobile, so the composition is centred inside a
 * square viewBox over a full-bleed ground: cropping in either direction can
 * only trim margin, never reach an empty edge or clip the mark.
 */
export function splashDataUri(name: string, tagline: string, colors: MarkColors): string {
  const label = escapeXml(name.trim() || 'CommunityEvents');
  const sub = escapeXml((tagline ?? '').trim());
  const initials = escapeXml(brandInitials(name));

  const S = 600;
  const nameFit = fitText(label, 460, 58);
  const subFit = fitText(sub, 420, 26);

  // Same absolute-lightness approach as BrandConfigService.applyChrome: a dark
  // ground in the brand's own hue, with a light tint of it for the ink.
  const deep = reshade(colors.primary, 22, 70);
  const lift = reshade(colors.primary, 46, 65);
  const onDark = reshade(colors.primary, 92, 40);

  return svgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}"
         width="${S}" height="${S}" role="img" aria-label="${label}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stop-color="${lift}"/>
          <stop offset="1" stop-color="${deep}"/>
        </linearGradient>
      </defs>
      <rect width="${S}" height="${S}" fill="url(#g)"/>
      <circle cx="${S / 2}" cy="238" r="74" fill="none" stroke="${onDark}" stroke-width="3" opacity="0.5"/>
      <text x="${S / 2}" y="239" text-anchor="middle" dominant-baseline="central"
            font-family="${FONT_STACK}" font-size="58" font-weight="700"
            fill="${onDark}">${initials}</text>
      <text x="${S / 2}" y="372" text-anchor="middle" dominant-baseline="central"
            font-family="${FONT_STACK}" font-size="${nameFit.size.toFixed(1)}" font-weight="700"
            fill="${onDark}"${textLengthAttrs(nameFit.textLength)}>${label}</text>
      ${
        sub
          ? `<text x="${S / 2}" y="424" text-anchor="middle" dominant-baseline="central"
            font-family="${FONT_STACK}" font-size="${subFit.size.toFixed(1)}" font-weight="400"
            fill="${onDark}" opacity="0.82"${textLengthAttrs(subFit.textLength)}>${sub}</text>`
          : ''
      }
    </svg>
  `);
}

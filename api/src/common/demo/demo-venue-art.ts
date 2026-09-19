/**
 * Cover art for the demo's venues (v2-14).
 *
 * The demo's events showed a flat gradient placeholder, because a seeded venue
 * has no photographs — four dark blocks down the page, which is the first thing
 * a visitor sees and reads as "this product has no content in it".
 *
 * ## Why generated rather than shipped
 *
 * Real photographs would mean licensing five images and carrying them in the
 * repository for one fictional community. Generated art costs nothing, cannot
 * be wrong about who owns it, and matches how the rest of this community's
 * identity already works — `brand-mark.util.ts` draws a logo rather than
 * shipping one, for the same reason.
 *
 * ## Why a route rather than a data URI
 *
 * `location_photos.filePath` is VarChar(500) and an encoded SVG of any
 * substance is several times that, so the art cannot live in the column. It is
 * served instead, and the column holds a short path — which is also what a real
 * uploaded photo holds, so the card component needs no special case.
 *
 * The art is a pure function of the slug, so nothing is stored, nothing needs
 * cleaning up when a demo is deleted, and two demos showing the same venue show
 * the same picture.
 *
 * Deliberately abstract: no text, no attempt at a photograph. A recognisable
 * drawing of a restaurant done badly looks worse than a composition that is
 * plainly decorative, and abstraction is honest about being a stand-in.
 *
 * ## This is the fallback now
 *
 * The five seeded venues have real (AI-generated) photographs as of this item,
 * shipped as static assets — see `venuePhotoPath`. This generator stays as the
 * answer for a venue with no such file: without it, a missing or renamed asset
 * would put a broken-image icon on the demo's front page, which is worse than
 * the plain panel it replaced.
 */
import { hexToHsl, hslToHex, reshade } from '../utils/color.util';

/** The demo's identity, shared by the brand marks, the seed and this art. */
export const DEMO_COLOR_PRIMARY = '#2E7D8F';
export const DEMO_COLOR_ACCENT = '#E0A458';
export const DEMO_COLOR_BACKGROUND = '#F7FAFB';

/** Matches what the seed writes into `filePath`, so the two cannot drift. */
export function venueSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

export const VENUE_SLUG_PATTERN = /^[a-z0-9-]{1,64}$/;

/**
 * A small deterministic hash, so a venue's art is stable across demos and
 * across restarts. Not security-relevant; it only has to spread evenly.
 */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Rotates around the brand hue rather than across the whole wheel.
 *
 * Five venues need to be distinguishable at a glance, but they belong to one
 * community — a rainbow would read as five unrelated sites. A window of about
 * 80 degrees gives cards that differ without leaving the family.
 */
function venueHue(primary: string, seed: number): { h: number; s: number; l: number } {
  const base = hexToHsl(primary) ?? { h: 195, s: 50, l: 37 };
  const offset = ((seed % 81) - 40) * 0.9;
  return { h: (base.h + offset + 360) % 360, s: base.s, l: base.l };
}

const W = 480;
const H = 200;

/**
 * One venue's cover, as raw SVG markup.
 *
 * Composed in bands so it survives the crop: the card shows roughly the middle
 * of this at 474x160, and the event page shows more of it, so nothing
 * meaningful sits near an edge.
 */
export function venueArtSvg(slug: string, primary = DEMO_COLOR_PRIMARY): string {
  const seed = hash(slug);
  const { h, s, l } = venueHue(primary, seed);

  const sky = hslToHex({ h, s: Math.min(s + 8, 70), l: Math.min(l + 26, 62) });
  const deep = hslToHex({ h, s: Math.min(s + 14, 74), l: Math.max(l - 14, 12) });
  const counter = hslToHex({ h, s: Math.max(s - 6, 18), l: Math.max(l - 22, 9) });
  const glow = reshade(DEMO_COLOR_ACCENT, 70, 62);

  // Three lamps at stable but uneven positions, so the cards do not look
  // stamped from one template.
  const lamps = [0, 1, 2].map((i) => {
    const x = 88 + ((seed >> (i * 3)) % 5) * 26 + i * 108;
    const drop = 26 + ((seed >> (i * 2)) % 4) * 9;
    return `<line x1="${x}" y1="0" x2="${x}" y2="${drop}" stroke="${deep}" stroke-width="2" opacity="0.5"/>
      <circle cx="${x}" cy="${drop + 7}" r="7.5" fill="${glow}" opacity="0.92"/>
      <circle cx="${x}" cy="${drop + 7}" r="15" fill="${glow}" opacity="0.16"/>`;
  });

  // Plates along the counter, sized off the seed.
  const plates = [0, 1, 2, 3].map((i) => {
    const x = 74 + i * 112 + ((seed >> (i + 4)) % 3) * 9;
    const r = 15 + ((seed >> i) % 3) * 3;
    return `<ellipse cx="${x}" cy="${H - 34}" rx="${r}" ry="${r * 0.34}" fill="${sky}" opacity="0.5"/>
      <ellipse cx="${x}" cy="${H - 36}" rx="${r * 0.62}" ry="${r * 0.21}" fill="${sky}" opacity="0.75"/>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"
       role="img" aria-label="Venue artwork">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${sky}"/>
      <stop offset="1" stop-color="${deep}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <!-- Biased to one edge rather than anywhere across the width: placed freely
       it landed behind the lamp row about half the time and read as a smudge
       rather than as light. -->
  <circle cx="${seed % 2 === 0 ? 54 + (seed % 40) : W - 54 - (seed % 40)}" cy="${38 + (seed % 14)}"
          r="30" fill="${glow}" opacity="0.13"/>
  ${lamps.join('')}
  <rect x="0" y="${H - 46}" width="${W}" height="46" fill="${counter}"/>
  <rect x="0" y="${H - 46}" width="${W}" height="3" fill="${glow}" opacity="0.4"/>
  ${plates.join('')}
</svg>`;
}

/**
 * Where a seeded venue's photograph lives, if it has one.
 *
 * Served as a static asset rather than generated, because these are actual
 * images and there is nothing to derive them from. They sit under the
 * frontend's `public/` and are therefore the same for every demo, which is
 * right: the venues are a fixed fiction, not per-community data.
 *
 * `VENUES_WITH_PHOTOS` is the authority on which files exist. The seed asks
 * this rather than assuming, so a venue added to the seed without artwork
 * falls back to the generated panel instead of pointing at a file that is not
 * there. A spec keeps this list and the files on disk in step.
 */
export const VENUES_WITH_PHOTOS = [
  'the-copper-kettle',
  'miriam-and-sons',
  'northside-noodle-house',
  'pearl-and-rye',
  'the-long-room',
] as const;

export function venuePhotoPath(slug: string): string | null {
  return (VENUES_WITH_PHOTOS as readonly string[]).includes(slug)
    ? `/venues/${slug}.webp`
    : null;
}

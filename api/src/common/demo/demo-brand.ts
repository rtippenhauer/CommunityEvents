/**
 * The demo community's own artwork (v2-14).
 *
 * The demo is a fiction we control — "Riverside Community Events", with
 * invented venues and members — so its logo is seeded fixture data exactly like
 * the rest of it, written to `brand_logo_url` at creation. That is not the same
 * thing as a compiled-in default, which is what v2-10 spent an item removing:
 * a default stands in for *any* community's identity and is therefore always
 * wrong, while this one belongs to a specific fictional community and is right
 * by construction.
 *
 * ## Why the mark carries its own background
 *
 * An uploaded logo is used unchanged wherever it appears — it is the
 * community's artwork and not ours to recolour — and `logoSrc` renders in five
 * places: three on the dark chrome (toolbar, sidenav, footer) and two on light
 * surfaces (the settings preview, the reservation-confirm page). A seeded logo
 * therefore has to read on both, which no single ink can do: near-black
 * disappears on the chrome and near-white disappears on the page. v2-14 already
 * fixed that for the *generated* wordmark by measuring its ink against the
 * ground, but that machinery cannot help here, because an upload is
 * deliberately not recoloured.
 *
 * So the lockup sits on its own rounded panel in the brand's deep tone. On the
 * chrome it reads as a slightly raised badge; on a light page it reads as a
 * dark badge. Either way its contrast is a property of the artwork rather than
 * of whatever happens to be behind it.
 *
 * Pure string building with no DOM, matching `brand-mark.util.ts` on the
 * frontend — this runs in a seed, where there is no document.
 */
import { reshade } from '../utils/color.util';

/**
 * Wide enough for the longest line at the size it is drawn, with the panel's
 * own padding included. Fixed rather than measured: this mark exists for one
 * known name, so fitting text at runtime would be machinery for a case that
 * cannot arise.
 */
const WIDTH = 268;
const HEIGHT = 48;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg.replace(/\s+/g, ' ').trim())}`;
}

const FONT_STACK =
  "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

/**
 * Splits "Riverside Community Events" into the name it is known by and the
 * words that qualify it, so the lockup stays in step if DEMO_BRAND_NAME
 * changes rather than freezing today's spelling into a drawing.
 */
function splitName(name: string): { lead: string; rest: string } {
  const words = name.trim().split(/\s+/);
  if (words.length <= 1) return { lead: words[0] ?? 'Demo', rest: '' };
  return { lead: words[0], rest: words.slice(1).join(' ') };
}

/** Three strokes suggesting moving water, for the roundel. */
function waves(cx: number, cy: number, stroke: string): string {
  return [0, 7, 14]
    .map((offset, i) => {
      const y = cy - 7 + offset;
      const width = [9, 11, 9][i];
      return `<path d="M ${cx - width} ${y} q ${width / 2} -4 ${width} 0 q ${width / 2} 4 ${width} 0"
        fill="none" stroke="${stroke}" stroke-width="2.2" stroke-linecap="round" opacity="${0.95 - i * 0.18}"/>`;
    })
    .join('');
}

/**
 * The full lockup: roundel plus the two-line name, on its own panel.
 *
 * Two lines rather than one because the name is long and a single line at this
 * height renders as a thin strip the eye skips. Stacked, the community reads as
 * "Riverside" with a qualifier, which is how somebody would say it aloud.
 */
export function demoLogoDataUri(name: string, primary: string): string {
  const { lead, rest } = splitName(name);
  const panel = reshade(primary, 16, 55);
  const ink = reshade(primary, 97, 30);
  const accent = reshade(primary, 62, 70);

  return svgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}"
         width="${WIDTH}" height="${HEIGHT}" role="img"
         aria-label="${escapeXml(name)}">
      <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="12" fill="${panel}"/>
      <circle cx="30" cy="24" r="15" fill="none" stroke="${accent}" stroke-width="2" opacity="0.65"/>
      ${waves(30, 24, accent)}
      <text x="56" y="21" font-family="${FONT_STACK}" font-size="18" font-weight="700"
            fill="${ink}" dominant-baseline="middle">${escapeXml(lead)}</text>
      ${
        rest
          ? `<text x="57" y="36" font-family="${FONT_STACK}" font-size="9.5" font-weight="600"
               letter-spacing="2.1" fill="${accent}"
               dominant-baseline="middle">${escapeXml(rest.toUpperCase())}</text>`
          : ''
      }
    </svg>
  `);
}

/**
 * The square mark on its own, for the favicon, push notifications and anywhere
 * a logo would be too wide. Same roundel so the two read as one identity.
 */
export function demoIconDataUri(primary: string): string {
  const S = 128;
  const panel = reshade(primary, 16, 55);
  const accent = reshade(primary, 62, 70);

  return svgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}"
         role="img" aria-label="Riverside">
      <rect width="${S}" height="${S}" rx="28" fill="${panel}"/>
      <circle cx="${S / 2}" cy="${S / 2}" r="40" fill="none" stroke="${accent}"
              stroke-width="5" opacity="0.6"/>
      <g transform="translate(${S / 2 - 30}, ${S / 2 - 24}) scale(2.6)">
        ${waves(11.5, 9, accent)}
      </g>
    </svg>
  `);
}

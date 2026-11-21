// The copyable prompt for generating a community's brand images.
//
// Same round trip as `admin/appearance/palette-prompt.ts`, and the same
// reasoning: an admin who does not own design software describes nothing and
// still gets usable artwork. The difference is where the answer comes back.
// A palette returns as text and is parsed, so that prompt is fixed and its
// parser is its contract; images return as files an admin uploads by hand, so
// there is nothing here to parse and no shape to keep in step.
//
// What this one must do instead is carry the community's OWN identity into
// the request. A generic "make me a logo" prompt produces artwork for no
// community in particular -- the same failure `brand-mark.util.ts` exists to
// avoid, one layer out. So the name, tagline and three seed colours are
// interpolated, and the slots named here are exactly the slots Site Settings
// can upload, in the order the screen lists them.

/** What the prompt needs to know. A subset of BrandConfig, so it stays pure. */
export interface ImagePromptBrand {
  name: string;
  tagline: string;
  colorPrimary: string;
  colorAccent: string;
  colorBackground: string;
  dinnerPluralLower: string;
}

/**
 * The six uploadable slots, with the size and shape each one is drawn at.
 *
 * The dimensions are what the app actually renders, not round numbers: the
 * logo sits in a 120x48 preview and a nav bar, the icon is a square mark, and
 * the hero is full-bleed behind text. An admin given a square hero gets a crop
 * they did not choose, which looks like a bug in the page rather than a
 * mismatched upload.
 *
 * **The error backdrop is the one that is NOT full-bleed**, and it was
 * specified as though it were -- `1600x900px, landscape` against a box that is
 * 1232x1080 on a 1080p screen, because error pages sit in the same 1280px
 * column every other page does. `background-size: cover` then threw away about
 * a third of the upload's width, which reads as a badly sized image rather
 * than as a mismatch between the spec and the frame. It was briefly fixed the
 * other way round, by making the page full-bleed; Rob reverted that on
 * 2026-11-20 because every other page is the centred column and the error page
 * looked out of place without it. So the frame is the fixed thing here and the
 * spec follows it: 1600x1400 is 1.14:1, which is the box.
 *
 * That only became true once the box stopped changing shape. It was sized with
 * `min-height: 100vh`, so it was 1.14:1 on a 1080p desktop and 0.39:1 on a
 * phone -- one upload showing 70% of its height on the first and 49% of its
 * width on the second, with no spec able to satisfy both. `error-page.component.ts`
 * now pins it with `aspect-ratio: 8 / 7`, and **8/7 and 1600x1400 are the same
 * number written twice** -- change one without the other and this slot silently
 * goes back to being cropped.
 */
const SLOTS = [
  {
    label: 'Logo',
    spec: '1200x400px, transparent PNG, wide',
    brief:
      'the wordmark shown in the nav bar and footer. The community NAME must be legible at ' +
      '160px wide. A small symbol beside the text is fine; text alone is also fine.',
  },
  {
    label: 'Icon',
    spec: '512x512px, square PNG',
    brief:
      'the favicon and small app mark. No words beyond a monogram of one or two letters -- ' +
      'it is rendered as small as 16px.',
  },
  {
    label: 'Splash',
    spec: '1600x900px, landscape',
    brief:
      'the hero image on the login page. It should suggest ' +
      'people sharing a table, without legible text of its own.',
  },
  {
    label: 'Hero Background',
    spec: '2400x1000px, very wide landscape',
    brief:
      'sits behind the home page welcome, with a colour wash laid over it and text on top. ' +
      'Busy or bright is fine; avoid anything with its own writing.',
  },
  {
    label: 'Story Brand Image',
    spec: '1200x800px, landscape',
    brief: 'illustrates the "Our Story" section on the home page. Warmer and more candid.',
  },
  {
    label: 'Error Page Backdrop',
    spec: '1600x1400px, slightly wider than tall',
    brief:
      'sits behind error pages, framed in the page column rather than filling the window, ' +
      'with a small card centred on it. It should be calm and low-contrast -- an apology, ' +
      'not a celebration -- because it is seen when something has gone wrong. Keep anything ' +
      'you care about away from the centre, where the card covers it.',
  },
] as const;

/**
 * Build the prompt for this community.
 *
 * One prompt asking for six images rather than six prompts: the images have to
 * look like a set, and an assistant told about all six at once keeps a
 * consistent subject and treatment across them. The slot labels match the
 * screen word for word so there is no guessing which file goes where.
 */
export function buildImagePrompt(brand: ImagePromptBrand): string {
  const slots = SLOTS.map(
    (s, i) => `${i + 1}. **${s.label}** — ${s.spec}. This is ${s.brief}`,
  ).join('\n');

  return `I need a set of brand images for a community website. Please generate them one at a time, and ask me before moving on to the next.

The community is called "${brand.name}".
Its tagline is "${brand.tagline}".
It organises recurring ${brand.dinnerPluralLower} where people eat together.

Use these brand colours throughout, so the set looks like it belongs to one community:
- Primary: ${brand.colorPrimary}
- Accent: ${brand.colorAccent}
- Background: ${brand.colorBackground}

Keep one visual style across all six — the same illustration or photographic treatment, the same palette, the same mood. Warm and welcoming, not corporate.

The six images:

${slots}

Please produce each at the stated size. Do not add any text to the images except where a brief asks for it.`;
}

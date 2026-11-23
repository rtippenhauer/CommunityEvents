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
 * The dimensions are what the app actually renders, not round numbers. An
 * admin given a square hero gets a crop they did not choose, which looks like
 * a bug in the page rather than a mismatched upload.
 *
 * **Every slot was measured against its real frame on 2026-11-23**, after the
 * error backdrop turned out to have been specified against a frame nobody had
 * looked at. It was not the exception. At 1920x1080 and at 390x844:
 *
 * | Slot    | Frame @1920 | Frame @390 | Fixed shape? |
 * | ------- | ----------- | ---------- | ------------ |
 * | Logo    | 32x32 contain | same     | yes, height-driven |
 * | Splash  | 812x964 (0.84) | 328x240 (1.37) | NO |
 * | Hero    | 1280x679 (1.89) | 360x1055 (0.34) | NO |
 * | Story   | follows the upload | follows the upload | no frame at all |
 * | Error   | 760x665 (1.143) | 358x324 (1.105) | yes, pinned |
 *
 * **Only the error backdrop could be pinned, and that is not an oversight.**
 * It holds one small card, so a fixed `aspect-ratio` cannot clip anything.
 * `.hero` is a two-column grid sized by its own copy and `.splash-panel` is a
 * flex column stretching to match the login form -- both MUST follow content,
 * and pinning either would cut text off. So their briefs describe the crop
 * range and ask for a centred subject rather than naming a frame that does not
 * exist. Do not "fix" them with an aspect-ratio later; that trade was looked at
 * and the text is what loses.
 *
 * **Story has no frame.** `.map-img` is `width: 100%` with height auto, so the
 * image renders at its own ratio, whole, always. The computed `object-fit:
 * fill` on it is the CSS default and never engages, because height is never
 * constrained -- it looks like a distortion bug in a devtools readout and is
 * not one.
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
      'the wordmark shown in the nav bar and footer. It is rendered 32px TALL -- about ' +
      '96px wide at this shape -- so the community NAME has to survive being that small. ' +
      'Few letters, heavy strokes, high contrast. A small symbol beside the text is fine; ' +
      'text alone is also fine.',
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
    spec: '1400x1200px, a little wider than tall',
    brief:
      'the panel beside the login form. Its shape is not fixed -- it is tall and narrow ' +
      'next to the form on a desktop and a short wide band above it on a phone -- so it is ' +
      'cropped differently on every screen. Keep the subject centred and leave room at all ' +
      'four edges. It should suggest people sharing a table, without legible text of its own.',
  },
  {
    label: 'Hero Background',
    spec: '2400x1350px, wide landscape',
    brief:
      'sits behind the home page welcome, with a colour wash laid over it and text on top. ' +
      'It is cropped hard and unpredictably -- the page is wide on a desktop and very tall ' +
      'on a phone -- so only the centre is reliably visible. Busy or bright is fine; avoid ' +
      'anything with its own writing, and avoid putting the subject near an edge.',
  },
  {
    label: 'Story Brand Image',
    spec: '1200x800px, landscape (any shape works)',
    brief:
      'illustrates the "Our Story" section on the home page. Warmer and more candid. This ' +
      'is the one image that is never cropped -- it is shown whole at whatever shape you ' +
      'give it -- so a portrait or a square is fine if it suits the picture better.',
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

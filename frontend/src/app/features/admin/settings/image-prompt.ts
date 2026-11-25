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
 * | Splash  | 812x964 (0.84) | 328x240 (1.37) | width yes, height viewport |
 * | Hero    | 1280x404 (3.17) signed out, 1280x679 (1.89) signed in | 360x746 (0.48) | NO |
 * | Story   | follows the upload | follows the upload | no frame at all |
 * | Error   | 760x665 (1.143) | 358x324 (1.105) | yes, pinned |
 *
 * **Only the error backdrop could be pinned, and that is not an oversight.**
 * It holds one small card, so a fixed `aspect-ratio` cannot clip anything.
 * `.hero` is a two-column grid sized by its own copy, so it MUST follow
 * content and pinning it would cut text off; its brief describes the crop
 * range and asks for a centred subject rather than naming a frame that does
 * not exist.
 *
 * **Splash is the one that is predictable without being pinnable**, and this
 * comment said the opposite until 2026-11-23. It claimed `.splash-panel` is a
 * flex column "stretching to match the login form", i.e. content-driven like
 * `.hero`. It is not. `.login-page` is `min-height: calc(100vh - 64px - 52px)`
 * -- driven by the VIEWPORT, not by the form -- and `.splash-panel` is
 * `flex: 1` beside a `flex: 0 0 420px` form inside the 1232px column, so its
 * width is 812px at every desktop size and its height is the window minus
 * about 116px. That is not a fixed ratio, but it is a known RANGE, which is
 * all a spec needs:
 *
 * | Window    | Splash frame | Ratio |
 * | --------- | ------------ | ----- |
 * | 1920x1080 | 812x964      | 0.84  |
 * | 1920x900  | 812x784      | 1.04  |
 * | 2560x1440 | 812x1324     | 0.61  |
 * | 390x844   | 328x240      | 1.37  |
 *
 * So the desktop frame is portrait and the phone band is landscape, and under
 * `object-fit: cover` the spec is whichever ratio loses least across all four.
 * Measured as the fraction of the upload actually visible:
 *
 * | Spec         | 1080p | 1440p | phone | worst |
 * | ------------ | ----- | ----- | ----- | ----- |
 * | 1600x900 old | 47%   | 34%   | 77%   | 34%   |
 * | 1400x1200    | 72%   | 52%   | 86%   | 52%   |
 * | 1200x1200    | 84%   | 61%   | 73%   | 61%   |
 * | 1200x1500    | 95%   | 76%   | 58%   | 58%   |
 *
 * **1200x1200 is specified because it maximises the worst case**, not because
 * square is tidy. The original `1600x900` was the real defect -- a 16:9 upload
 * in a portrait slot shows under half its width, which is the sliced-off faces
 * Rob saw on the Magick Musings login page. Portrait 1200x1500 reads better on
 * desktop and was briefly going to be specified, but it pays for that on the
 * phone band, where the frame flips landscape; square is within a few points
 * of the best case everywhere and has no bad case.
 *
 * Pinning the panel with an `aspect-ratio` is still wrong, for a different
 * reason than `.hero`: the panel's job is to fill the page's height beside the
 * form, and pinning it would either leave a gap under it or push the page
 * taller than the viewport. The frame is predictable; it is not fixed. Spec to
 * the range, do not pin.
 *
 * **Hero is specified at 1.2 because that maximises its worst case too**, by
 * the same arithmetic and with a much wider swing to cover. Measured on stage
 * 2026-11-23, the frame is 3.17 signed out, 1.89 signed in, and 0.48 on a
 * phone -- a 6.5x range, because `.hero` is a two-column grid on a desktop and
 * a stacked single column on a phone. Balancing the extremes puts the ideal
 * near the geometric mean of the widest and narrowest frame, which lands just
 * over 1:1:
 *
 * | Spec         | signed out | signed in | phone | worst |
 * | ------------ | ---------- | --------- | ----- | ----- |
 * | 2400x1350    | 56%        | 94%       | 27%   | 27%   |
 * | 1942x809 old | 76%        | 79%       | 20%   | 20%   |
 * | 1200x1000    | 38%        | 63%       | 40%   | 38%   |
 *
 * 38% sounds poor and is the best available: the slot cannot show most of an
 * upload at both extremes, which is why the brief calls it a texture. The
 * earlier `2400x1350` was picked to look like a hero image rather than to fit
 * this frame, and cost the phone two thirds of the upload's width.
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
      'the wordmark shown in the nav bar and footer. It is rendered 32px TALL with its width ' +
      'left to follow this shape -- about 96px at 3:1 -- so the community NAME has to ' +
      'survive being that small. A SQUARE upload here renders 32x32 and can only hold a ' +
      'monogram, which wastes the slot: the nav then shows no community name at all. ' +
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
    spec: '1200x1200px, square',
    brief:
      'the panel beside the login form. Square on purpose: the panel is TALLER than it is ' +
      'wide next to the form on a desktop, and a short wide band above it on a phone, so a ' +
      'square loses the least to cropping at both. Keep the subject centred and leave room ' +
      'at all four edges -- the edges are what gets cut. It should suggest people sharing a ' +
      'table, without legible text of its own.',
  },
  {
    label: 'Hero Background',
    spec: '1200x1000px, slightly wider than tall',
    brief:
      'the backdrop behind the home page welcome, with a colour wash laid over it and text ' +
      'on top. ' +
      'This is the most heavily cropped slot in the set -- the frame is a wide band on a ' +
      'desktop and a tall column on a phone, so only the middle is ever reliably visible, ' +
      'and no shape avoids that. Treat it as a texture rather than a picture: busy or bright ' +
      'is fine, nothing with its own writing, and nothing you care about near an edge.',
  },
  {
    label: 'Story Brand Image',
    spec: '1200x800px, landscape (any shape works)',
    brief:
      'the picture illustrating the "Our Story" section on the home page. Warmer and more ' +
      'candid. This ' +
      'is the one image that is never cropped -- it is shown whole at whatever shape you ' +
      'give it -- so a portrait or a square is fine if it suits the picture better.',
  },
  {
    label: 'Error Page Backdrop',
    spec: '1600x1400px, slightly wider than tall',
    brief:
      'the backdrop behind error pages, framed in the page column rather than filling the ' +
      'window, ' +
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
 *
 * **Every brief must read as a NOUN PHRASE**, because the line below prefixes
 * it with "This is ". Three of them were verb phrases until 2026-11-24 and
 * shipped as "This is sits behind the home page welcome" and "This is
 * illustrates the Our Story section" -- in a prompt whose whole job is to be
 * pasted into an assistant, which is the one place sloppy wording is read
 * literally. A spec guards this now; it is not obvious from the slot table,
 * where each brief is just a string.
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

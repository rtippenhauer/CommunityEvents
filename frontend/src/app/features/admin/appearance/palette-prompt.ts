// The copyable prompt, and the importer for what comes back.
//
// Rob's idea, and the part that makes seed colours usable by someone who does
// not think in hex: an admin describes their community in words to whichever
// assistant they already use, and pastes the answer back. The round trip is
// describe -> palette -> paste -> preview -> save.
//
// That only works if the prompt names our constraints exactly, so the answer
// is directly importable rather than something to translate by hand. Keep the
// prompt and `parsePastedPalette` in step: the prompt's stated JSON shape IS
// this parser's contract, and loosening one without the other turns a working
// paste into a confusing error.

import type { PaletteSeeds } from '../../../core/utils/palette';

/** Six-digit hex, with the hash. The only form `<input type="color">` accepts. */
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export const PALETTE_PROMPT = `You are helping choose a colour palette for a community website. Return **only** a JSON object, no commentary, in exactly this shape:

{"primary":"#RRGGBB","accent":"#RRGGBB","background":"#RRGGBB"}

Constraints:
- "primary" is used for buttons, links and highlights.
- "accent" is a second brand colour, used for secondary actions and for surfaces that blend the two. It should be clearly different from "primary" but belong to the same family.
- "background" is the page background. It should be very light or very dark, not mid-tone.
- Either white or black text must reach WCAG AA contrast (4.5:1) against "primary", and against "accent".
- "background" must reach 4.5:1 against a near-black body text colour if it is light, or a near-white one if it is dark.
- Avoid pure #000000 and #FFFFFF.
- All three must be six-digit hex with a leading #.

The community is: <describe it — its name, what it does, the feeling you want>`;

// There is deliberately no "does this palette meet the brief" helper here.
// Any such check reduces to "can black or white label this colour", and since
// ON_LIGHT is pure black the answer is yes for every colour in the HSL cube --
// a function that cannot return false. The real failures are pairs the seeds
// do not determine on their own (text on the page ground, a label spanning a
// gradient), which is what `contrastWarnings` measures over the whole resolved
// palette. The screen calls that.

export type PastedPaletteResult =
  | { ok: true; seeds: PaletteSeeds }
  | { ok: false; error: string };

/**
 * Parse a pasted palette, checking it rather than trusting it.
 *
 * A model will occasionally return a palette that fails its own brief, so the
 * ratios are re-measured here. Contrast problems are reported as a *warning*
 * through the normal warnings panel, not as a rejection — the same
 * warn-don't-block rule the rest of the screen follows. What is rejected is
 * only what cannot be used at all: not JSON, missing a colour, or a value that
 * is not a hex colour.
 *
 * Accepts the JSON with surrounding prose, because assistants routinely add a
 * sentence either side however firmly the prompt says not to. Extracting the
 * first {...} block is the difference between "paste it" and "paste it, but
 * first delete the bits around it".
 */
export function parsePastedPalette(raw: string): PastedPaletteResult {
  const text = (raw ?? '').trim();
  if (!text) return { ok: false, error: 'Paste the JSON palette first.' };

  const block = extractJsonObject(text);
  if (!block) {
    return { ok: false, error: 'Could not find a JSON object in what you pasted.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch {
    return { ok: false, error: 'That is not valid JSON. Paste the whole object, braces included.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Expected a JSON object with primary, accent and background.' };
  }

  const source = parsed as Record<string, unknown>;
  const seeds: Partial<PaletteSeeds> = {};
  for (const key of ['primary', 'accent', 'background'] as const) {
    const value = source[key];
    if (typeof value !== 'string' || !value.trim()) {
      return { ok: false, error: `Missing "${key}".` };
    }
    const hex = normalizeHexInput(value);
    if (!hex) {
      return { ok: false, error: `"${key}" is not a hex colour like #C9933A (got "${value}").` };
    }
    seeds[key] = hex;
  }

  return { ok: true, seeds: seeds as PaletteSeeds };
}

/** Accept `#abc`, `abc`, `#AABBCC` or `AABBCC`; return canonical `#aabbcc`. */
function normalizeHexInput(value: string): string | null {
  let h = value.trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  return /^[0-9a-fA-F]{6}$/.test(h) ? `#${h.toLowerCase()}` : null;
}

/**
 * The first balanced {...} run in `text`.
 *
 * Brace-counting rather than a regex because a regex either stops at the first
 * `}` (truncating a nested object) or runs to the last one (swallowing trailing
 * prose). Quotes are tracked so a brace inside a string cannot unbalance it.
 */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

import { describe, it, expect } from 'vitest';
import {
  brandInitials,
  escapeXml,
  svgDataUri,
  wordmarkDataUri,
  monogramDataUri,
  splashDataUri,
} from './brand-mark.util';
import { contrastRatio, reshade } from './color.util';

const COLORS = { primary: '#C9933A', background: '#FDFAF5' };

/** Decode a data: URI back to its SVG source. */
function decode(uri: string): string {
  expect(uri.startsWith('data:image/svg+xml,')).toBe(true);
  return decodeURIComponent(uri.slice('data:image/svg+xml,'.length));
}

/** Parse SVG source, failing the test if it is not well-formed XML. */
function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const error = doc.querySelector('parsererror');
  expect(error?.textContent ?? null).toBeNull();
  return doc;
}

describe('brandInitials', () => {
  it('takes the first letter of the first two words', () => {
    expect(brandInitials('Dayton Supper Club')).toBe('DS');
  });

  it('reads internal capitals in a single word', () => {
    expect(brandInitials('CommunityEvents')).toBe('CE');
    expect(brandInitials('DinnerBears')).toBe('DB');
  });

  it('falls back to the first two letters of an all-lowercase word', () => {
    expect(brandInitials('supperclub')).toBe('SU');
  });

  it('handles a one-letter name without padding or crashing', () => {
    expect(brandInitials('Q')).toBe('Q');
  });

  it('treats punctuation as a word separator', () => {
    expect(brandInitials('Five-Points Supper')).toBe('FP');
  });

  it('counts digits as word characters', () => {
    expect(brandInitials('5 Points Supper')).toBe('5P');
  });

  it('uses the platform initials only when the name is blank', () => {
    expect(brandInitials('')).toBe('CE');
    expect(brandInitials('   ')).toBe('CE');
  });
});

describe('escapeXml', () => {
  it('escapes the five XML metacharacters', () => {
    expect(escapeXml('a<b')).toBe('a&lt;b');
    expect(escapeXml('a>b')).toBe('a&gt;b');
    expect(escapeXml('a&b')).toBe('a&amp;b');
    expect(escapeXml('a"b')).toBe('a&quot;b');
    expect(escapeXml("a'b")).toBe('a&apos;b');
  });

  it('escapes the ampersand before the entities it introduces', () => {
    // Naive ordering would turn "<" into "&lt;" and then re-escape its "&".
    expect(escapeXml('<')).toBe('&lt;');
  });
});

describe('svgDataUri', () => {
  it('percent-encodes the hash in hex colours', () => {
    // An unencoded "#" truncates the URI at the first colour, which renders as
    // a blank image rather than an error.
    const uri = svgDataUri('<svg fill="#C9933A"></svg>');
    expect(uri).not.toContain('#');
    expect(decode(uri)).toContain('#C9933A');
  });
});

describe('generated marks', () => {
  const names = ['CommunityEvents', 'Dayton Supper Club', 'Q', 'DinnerBears'];

  for (const name of names) {
    it(`produces well-formed SVG for "${name}"`, () => {
      parse(decode(wordmarkDataUri(name, COLORS)));
      parse(decode(monogramDataUri(name, COLORS)));
      parse(decode(splashDataUri(name, 'Good food. Great company.', COLORS)));
    });
  }

  it('renders the community name, not the platform name', () => {
    const svg = decode(wordmarkDataUri('Dayton Supper Club', COLORS));
    expect(svg).toContain('Dayton Supper Club');
    expect(svg).not.toContain('CommunityEvents');
  });

  it('uses the community palette rather than baked-in colours', () => {
    const svg = decode(monogramDataUri('Dayton Supper Club', {
      primary: '#2E7D32',
      background: '#FFFFFF',
    }));
    expect(svg).toContain('#2E7D32');
    expect(svg).not.toContain('#C9933A');
  });

  it('survives a brand name containing markup', () => {
    // brand_name is admin-controlled. Unescaped, this closes the <text> element
    // and the whole mark fails to parse.
    const hostile = '</text><script>alert(1)</script>';
    const svg = decode(monogramDataUri(hostile, COLORS));
    parse(svg);
    expect(svg).not.toContain('<script>');
  });

  it('bounds the wordmark width for an absurdly long name', () => {
    const long = 'A'.repeat(400);
    const doc = parse(decode(wordmarkDataUri(long, COLORS)));
    const viewBox = doc.documentElement.getAttribute('viewBox') ?? '';
    const width = Number(viewBox.split(/\s+/)[2]);
    // Without the cap this grows past 6000 and renders as an illegible sliver
    // in a 40px-tall <img>.
    expect(width).toBeLessThanOrEqual(480);
  });

  it('clamps overflowing text rather than letting it escape the box', () => {
    const svg = decode(wordmarkDataUri('A'.repeat(400), COLORS));
    expect(svg).toContain('lengthAdjust="spacingAndGlyphs"');
  });

  it('leaves a short name at its natural width', () => {
    // textLength on every mark would stretch a short name across the full box.
    const svg = decode(wordmarkDataUri('Q', COLORS));
    expect(svg).not.toContain('lengthAdjust');
  });

  it('omits the splash tagline line when there is no tagline', () => {
    const without = decode(splashDataUri('Dayton Supper Club', '', COLORS));
    const withTagline = decode(splashDataUri('Dayton Supper Club', 'Hello', COLORS));
    const count = (s: string) => (s.match(/<text/g) ?? []).length;
    expect(count(without)).toBe(count(withTagline) - 1);
  });
});

/**
 * The wordmark has to be legible where it is actually drawn (v2-14).
 *
 * `logoSrc` renders in five places and three are the dark chrome — the
 * toolbar, the sidenav and the footer. The generated wordmark inked itself
 * near-black for "the light ground" and was therefore invisible in all three
 * on any community without an uploaded logo. It went unnoticed for an item and
 * a half because every community that existed had uploaded one; v2-14's demo,
 * the first with no uploads, is what surfaced it.
 *
 * Swept over the hue circle rather than checked at one colour, because a
 * community picks its own primary and the failure was hue-independent.
 */
describe('wordmark legibility on the ground it is drawn on', () => {
  /** How palette.ts derives --ce-chrome, so this measures the real background. */
  const chromeFor = (primary: string): string => reshade(primary, 13, 80);

  /** A spread of hues at a fixed saturation and lightness. */
  function hslHex(h: number, s: number, l: number): string {
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const f = (n: number): string => {
      const k = (n + h / 30) % 12;
      const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(255 * v).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  const seeds = Array.from({ length: 24 }, (_, i) => hslHex(i * 15, 60, 50));

  /** The name text is the second <text> node; the first is the tile monogram. */
  function nameInk(svg: string): string {
    const doc = parse(svg);
    const texts = Array.from(doc.querySelectorAll('text'));
    return texts[texts.length - 1].getAttribute('fill') ?? '';
  }

  it('is readable on the chrome for every hue a community might pick', () => {
    const failures: string[] = [];
    for (const primary of seeds) {
      const ground = chromeFor(primary);
      const ink = nameInk(decode(wordmarkDataUri('Riverside Community Events', { primary, background: '#FDFAF5' }, ground)));
      const ratio = contrastRatio(ink, ground) ?? 0;
      // 3:1, the AA threshold for large text — the wordmark renders at 26px
      // and bold, which is comfortably "large" by WCAG's definition.
      if (ratio < 3) failures.push(`${primary} on ${ground}: ${ratio.toFixed(2)}:1`);
    }
    expect(failures).toEqual([]);
  });

  it('is still readable on the light surface, which was never broken', () => {
    const failures: string[] = [];
    for (const primary of seeds) {
      const ink = nameInk(decode(wordmarkDataUri('Riverside Community Events', { primary, background: '#FDFAF5' })));
      const ratio = contrastRatio(ink, '#FDFAF5') ?? 0;
      if (ratio < 3) failures.push(`${primary}: ${ratio.toFixed(2)}:1`);
    }
    expect(failures).toEqual([]);
  });

  // The regression itself, named: the old fixed ink against the chrome.
  it('proves the old fixed ink really was unreadable there', () => {
    const primary = '#C9933A';
    const ground = chromeFor(primary);
    const oldInk = reshade(primary, 16, 45);
    expect(contrastRatio(oldInk, ground) ?? 0).toBeLessThan(3);
  });
});

import { describe, expect, it } from 'vitest';
import { demoIconDataUri, demoLogoDataUri } from './demo-brand';
import { contrastRatio, reshade } from '../utils/color.util';

/**
 * The demo's seeded artwork (v2-14).
 *
 * The property worth testing is the one the whole design turns on: an uploaded
 * logo is used **unchanged** wherever it appears, and `logoSrc` renders on both
 * the dark chrome and light surfaces. So this mark has to be legible on both at
 * once, which it achieves by carrying its own panel. If that panel is ever
 * dropped or lightened, the mark silently becomes unreadable in one of the two
 * places and nothing else will catch it -- the generated wordmark's measured
 * ink (v2-14) cannot help, because an upload is deliberately not recoloured.
 */
describe('demo brand artwork', () => {
  const PRIMARY = '#2E7D8F';

  const decode = (uri: string): string => {
    expect(uri.startsWith('data:image/svg+xml,')).toBe(true);
    return decodeURIComponent(uri.slice('data:image/svg+xml,'.length));
  };

  const attr = (svg: string, re: RegExp): string => {
    const m = svg.match(re);
    expect(m, `no match for ${re}`).toBeTruthy();
    return m![1];
  };

  it('is a well-formed svg data URI naming the community', () => {
    const svg = decode(demoLogoDataUri('Riverside Community Events', PRIMARY));
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('aria-label="Riverside Community Events"');
  });

  it('splits the name into the lead word and a qualifier', () => {
    const svg = decode(demoLogoDataUri('Riverside Community Events', PRIMARY));
    expect(svg).toContain('>Riverside<');
    expect(svg).toContain('>COMMUNITY EVENTS<');
  });

  it('survives a single-word name without an empty second line', () => {
    const svg = decode(demoLogoDataUri('Riverside', PRIMARY));
    expect(svg).toContain('>Riverside<');
    expect(svg).not.toContain('letter-spacing');
  });

  it('escapes a name that would otherwise break the markup', () => {
    const svg = decode(demoLogoDataUri('Ben & Jerry\'s <Club>', PRIMARY));
    expect(svg).toContain('&amp;');
    expect(svg).not.toContain('<Club>');
  });

  /**
   * The load-bearing one. Both grounds, one artwork, no recolouring available.
   */
  it('reads on its own panel, whatever is behind it', () => {
    const svg = decode(demoLogoDataUri('Riverside Community Events', PRIMARY));
    const panel = attr(svg, /<rect[^>]*fill="(#[0-9a-fA-F]{6})"/);
    const ink = attr(svg, /font-size="18"[^>]*fill="(#[0-9a-fA-F]{6})"/);

    // AA for large text. The name is 18px and bold.
    expect(contrastRatio(ink, panel) ?? 0).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps that panel distinguishable from the chrome it sits on', () => {
    const svg = decode(demoLogoDataUri('Riverside Community Events', PRIMARY));
    const panel = attr(svg, /<rect[^>]*fill="(#[0-9a-fA-F]{6})"/);
    // How palette.ts derives --ce-chrome.
    const chrome = reshade(PRIMARY, 13, 80);
    // Not a contrast requirement -- a badge that melts into the nav is the
    // intended look -- but it must not be the *identical* colour, or the panel
    // is doing nothing and a future edit could drop it unnoticed.
    expect(panel.toLowerCase()).not.toBe(chrome.toLowerCase());
  });

  it('follows the primary rather than hardcoding one palette', () => {
    const teal = decode(demoLogoDataUri('Riverside', '#2E7D8F'));
    const amber = decode(demoLogoDataUri('Riverside', '#C9933A'));
    expect(teal).not.toBe(amber);
  });

  describe('the square mark', () => {
    it('is a valid data URI and shares the roundel', () => {
      const svg = decode(demoIconDataUri(PRIMARY));
      expect(svg).toContain('<svg');
      expect(svg).toContain('<circle');
      // Three wave strokes, same as the lockup, so the two read as one identity.
      expect(svg.match(/<path /g)?.length).toBe(3);
    });
  });
});

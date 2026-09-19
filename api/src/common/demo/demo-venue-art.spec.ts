import { describe, expect, it } from 'vitest';
import { VENUE_SLUG_PATTERN, venueArtSvg, venueSlug } from './demo-venue-art';

/**
 * Generated cover art for the demo's venues (v2-14).
 *
 * The properties that matter are determinism and the slug contract. The art
 * itself is decorative and untestable beyond "it is valid SVG" — but the slug
 * is written into `location_photos.filePath` by the seed and parsed back out of
 * the URL by the route, so the two agreeing is what makes any image appear at
 * all.
 */
describe('venue art', () => {
  const VENUES = [
    'The Copper Kettle',
    'Miriam and Sons',
    'Northside Noodle House',
    'Pearl and Rye',
    'The Long Room',
  ];

  describe('venueSlug', () => {
    it('produces slugs the route will accept', () => {
      for (const name of VENUES) {
        expect(venueSlug(name)).toMatch(VENUE_SLUG_PATTERN);
      }
    });

    it('collapses punctuation and trims the edges', () => {
      expect(venueSlug("  Miriam's  Table & Co!  ")).toBe('miriam-s-table-co');
    });

    it('stays within the column and the pattern for a very long name', () => {
      const slug = venueSlug('x'.repeat(200));
      expect(slug.length).toBeLessThanOrEqual(64);
      expect(slug).toMatch(VENUE_SLUG_PATTERN);
    });
  });

  describe('venueArtSvg', () => {
    it('is valid, self-contained SVG', () => {
      const svg = venueArtSvg('the-copper-kettle');
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
      // Nothing fetched at render time: the card must not depend on the network
      // for a picture that exists to make the page look populated. The xmlns
      // declaration is a namespace identifier, not a fetch, so the check is for
      // actual references rather than for the string "http".
      expect(svg).not.toMatch(/href\s*=|url\(\s*['"]?https?:/i);
    });

    // Stable across demos and restarts, so a venue does not change appearance
    // between two page loads.
    it('is a pure function of the slug', () => {
      expect(venueArtSvg('pearl-and-rye')).toBe(venueArtSvg('pearl-and-rye'));
      expect(venueArtSvg('pearl-and-rye')).not.toBe(venueArtSvg('the-long-room'));
    });

    // Five near-identical cards would be worse than none: the point is that a
    // visitor can tell the events apart at a glance.
    it('gives every seeded venue a distinguishable image', () => {
      const arts = new Set(VENUES.map((v) => venueArtSvg(venueSlug(v))));
      expect(arts.size).toBe(VENUES.length);
    });

    it('follows the palette it is given', () => {
      expect(venueArtSvg('pearl-and-rye', '#2E7D8F')).not.toBe(
        venueArtSvg('pearl-and-rye', '#8F2E4A'),
      );
    });
  });
});

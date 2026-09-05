import { describe, it, expect } from 'vitest';
import { hexToHsl, hslToHex, reshade, emailPalette } from './color.util';

describe('hexToHsl', () => {
  it('parses #rrggbb with or without the hash', () => {
    expect(hexToHsl('#ffffff')).toEqual({ h: 0, s: 0, l: 100 });
    expect(hexToHsl('000000')).toEqual({ h: 0, s: 0, l: 0 });
  });

  it('expands the three-digit form', () => {
    expect(hexToHsl('#fff')).toEqual(hexToHsl('#ffffff'));
  });

  it('returns null rather than throwing on an unparseable value', () => {
    // An admin can type anything into the colour field, and a bad value must
    // not be able to abort an email send.
    expect(hexToHsl('not a colour')).toBeNull();
    expect(hexToHsl('#12345')).toBeNull();
    expect(hexToHsl('')).toBeNull();
  });
});

describe('reshade', () => {
  it('preserves hue while moving lightness', () => {
    const hsl = hexToHsl(reshade('#C9933A', 13, 80))!;
    expect(Math.round(hsl.h)).toBe(Math.round(hexToHsl('#C9933A')!.h));
    expect(Math.round(hsl.l)).toBe(13);
  });

  it('returns the input unchanged when it cannot be parsed', () => {
    expect(reshade('nonsense', 20)).toBe('nonsense');
  });

  it('clamps rather than producing an invalid colour', () => {
    expect(hslToHex({ h: 0, s: 500, l: -20 })).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('emailPalette', () => {
  // The whole point of the lightness targets: a community still on the seeded
  // amber must keep the palette these templates were hand-written in, so this
  // change is invisible for them and correct for everyone else.
  it('reproduces the hand-written amber palette closely enough to be invisible', () => {
    const p = emailPalette('#C9933A', '#FDFAF5');
    const near = (got: string, want: string, tolerance = 24) => {
      const [gh, wh] = [got, want].map((v) => hexToHsl(v)!);
      const dist =
        Math.abs(gh.l - wh.l) + Math.abs(gh.s - wh.s) / 4 + Math.abs(gh.h - wh.h) / 8;
      expect(dist, `${got} vs ${want}`).toBeLessThan(tolerance);
    };
    near(p.band, '#3D1C05');
    near(p.inkMuted, '#6B4226');
    near(p.surfaceAlt, '#faf7f2');
    near(p.rule, '#e8e0d6');
  });

  it('follows a community that has changed its primary', () => {
    const p = emailPalette('#3f32f5', '#c0bcf5');
    // The band is a dark shade of the community's own hue, not brown. Compared
    // with a tolerance because a hex -> HSL -> hex round trip quantises to 8
    // bits per channel, which moves hue by a degree at these lightnesses.
    expect(Math.abs(hexToHsl(p.band)!.h - hexToHsl('#3f32f5')!.h)).toBeLessThanOrEqual(2);
    expect(hexToHsl(p.band)!.l).toBeLessThan(20);
    // The ground is whatever the community configured, used as-is.
    expect(p.pageBg).toBe('#c0bcf5');
    expect(p.primary).toBe('#3f32f5');
  });

  it('survives an unparseable primary without throwing', () => {
    const p = emailPalette('', '');
    expect(Object.values(p).every((v) => typeof v === 'string')).toBe(true);
  });
});

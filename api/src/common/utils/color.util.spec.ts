import { describe, it, expect } from 'vitest';
import {
  hexToHsl,
  hslToHex,
  reshade,
  emailPalette,
  contrastRatio,
  relativeLuminance,
  onColorFor,
  onColorForAll,
  readableOn,
  meetsAA,
  AA_NORMAL,
  ON_LIGHT,
  ON_DARK,
} from './color.util';

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

describe('contrast', () => {
  it('matches the WCAG reference points', () => {
    // Black on white is the definition's upper bound, and a colour against
    // itself is the lower one. If either drifts the formula is wrong.
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#C9933A', '#C9933A')).toBeCloseTo(1, 5);
  });

  it('is symmetric in its arguments', () => {
    expect(contrastRatio('#C9933A', '#ffffff')).toBeCloseTo(
      contrastRatio('#ffffff', '#C9933A')!,
      10,
    );
  });

  it('returns null rather than a passing-looking number on a bad colour', () => {
    // Returning 0 or 21 here would either warn on every valid palette or
    // silently pass an unreadable one; both are worse than "unknown".
    expect(contrastRatio('nonsense', '#ffffff')).toBeNull();
    expect(relativeLuminance('#12345')).toBeNull();
  });
});

describe('onColorFor', () => {
  it('picks dark text on the seeded amber, which white fails against', () => {
    // This is the defect v2-11 exists to fix: --mat-sys-on-primary was pinned
    // to white, and white on #C9933A measures 2.72:1 -- below AA's 4.5.
    expect(contrastRatio('#ffffff', '#C9933A')!).toBeLessThan(AA_NORMAL);
    expect(onColorFor('#C9933A')).toBe(ON_LIGHT);
    expect(meetsAA(onColorFor('#C9933A'), '#C9933A')).toBe(true);
  });

  it('picks white on a dark ground', () => {
    expect(onColorFor('#3D1C05')).toBe(ON_DARK);
  });

  it('falls back to white on an unparseable ground', () => {
    // Matches the colour this used to be hardcoded to, so a colour field an
    // admin has typed nonsense into renders as it always did.
    expect(onColorFor('')).toBe(ON_DARK);
  });

  // This is the guarantee ON_LIGHT is pure black to buy, and the reason to
  // keep it that way: sweep the whole space an admin can choose from and every
  // single colour still has a legible label. A softened black fails ~3.7% of
  // it -- the failures are mid-lightness saturated hues, which is exactly what
  // a community picking a vivid brand colour lands on.
  it('reaches AA on every colour an admin can pick', () => {
    let worst = { ratio: Infinity, bg: '' };
    for (let h = 0; h < 360; h += 5) {
      for (let s = 0; s <= 100; s += 10) {
        for (let l = 0; l <= 100; l += 5) {
          const bg = hslToHex({ h, s, l });
          const ratio = contrastRatio(onColorFor(bg), bg)!;
          if (ratio < worst.ratio) worst = { ratio, bg };
        }
      }
    }
    expect(worst.ratio, `worst at ${worst.bg}`).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe('readableOn', () => {
  it('keeps the preferred brand tone when it is legible', () => {
    const warmInk = reshade('#C9933A', 16, 45);
    expect(readableOn('#FDFAF5', warmInk)).toBe(warmInk);
  });

  it('abandons it when it is not', () => {
    // A dark ink on a dark ground: taste has to give way to measurement.
    const warmInk = reshade('#C9933A', 16, 45);
    expect(readableOn('#3D1C05', warmInk)).toBe(ON_DARK);
  });
});

describe('emailPalette onPrimary', () => {
  // Email is where this matters most: the markup is a literal at send time,
  // there is no stylesheet the member can correct and no way for them to
  // report a button they cannot read.
  it('is measured against the community primary, not assumed white', () => {
    expect(emailPalette('#C9933A', '#FDFAF5').onPrimary).toBe(ON_LIGHT);
    expect(emailPalette('#123456', '#FDFAF5').onPrimary).toBe(ON_DARK);
  });

  it('reaches AA against the button it labels', () => {
    for (const primary of ['#C9933A', '#123456', '#f2d98c', '#5570f6', '#d95326']) {
      const p = emailPalette(primary, '#ffffff');
      expect(meetsAA(p.onPrimary, p.primary), primary).toBe(true);
    }
  });
});

describe('onColorForAll', () => {
  it('agrees with onColorFor when every ground is the same', () => {
    // The seeded case: accent defaults to the primary, so the badge is flat
    // and the two functions must not disagree about how to label it.
    expect(onColorForAll(['#C9933A', '#C9933A'])).toBe(onColorFor('#C9933A'));
  });

  it('maximises the worst ground, not the average', () => {
    // White wins easily on the dark stop and loses on the pale one. Averaging
    // would pick white and leave the label invisible at one end of the
    // gradient; the worst case is what a reader actually hits.
    const stops = ['#111111', '#f2d98c'];
    const chosen = onColorForAll(stops);
    const worst = Math.min(...stops.map((s) => contrastRatio(chosen, s)!));
    const worstIfWhite = Math.min(...stops.map((s) => contrastRatio(ON_DARK, s)!));
    expect(worst).toBeGreaterThanOrEqual(worstIfWhite);
  });

  it('ignores grounds it cannot parse rather than throwing', () => {
    expect(onColorForAll(['#C9933A', 'not a colour'])).toBe(ON_LIGHT);
  });

  it('falls back to white when nothing is parseable', () => {
    expect(onColorForAll(['', 'nope'])).toBe(ON_DARK);
  });
});

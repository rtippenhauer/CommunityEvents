import { describe, it, expect } from 'vitest';
import {
  PALETTE_TOKENS,
  derivePalette,
  applyOverrides,
  resolvePalette,
  parseOverrides,
  contrastWarnings,
  type PaletteSeeds,
} from './palette';
import { contrastRatio, AA_NORMAL } from './color.util';

const AMBER: PaletteSeeds = { primary: '#C9933A', accent: '#C9933A', background: '#FDFAF5' };

describe('derivePalette', () => {
  it('produces every declared token', () => {
    // The Record type already forces this at compile time; the runtime check
    // catches a token that is present but empty, which the type cannot see.
    const p = derivePalette(AMBER);
    for (const token of PALETTE_TOKENS) {
      expect(p[token], token).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('passes the seeds through untouched', () => {
    const p = derivePalette(AMBER);
    expect(p['--ce-primary']).toBe('#C9933A');
    expect(p['--ce-accent']).toBe('#C9933A');
    expect(p['--ce-surface']).toBe('#FDFAF5');
  });

  it('derives the chrome in the brand hue, not a fixed brown', () => {
    const green = derivePalette({ primary: '#2E7D57', accent: '#2E7D57', background: '#ffffff' });
    // The old hardcoded chrome was #3D1C05. A green community must not get it.
    expect(green['--ce-chrome']).not.toBe('#3d1c05');
    expect(green['--ce-chrome'].toLowerCase()).not.toBe('#3D1C05'.toLowerCase());
  });

  it('is pure — the same seeds always give the same palette', () => {
    expect(derivePalette(AMBER)).toEqual(derivePalette({ ...AMBER }));
  });
});

describe('applyOverrides', () => {
  // The central claim of the {seeds, overrides} shape. If overrides were baked
  // into the seeds instead, changing a seed would either silently drop this
  // override or silently keep a stale one, and an admin could not tell which.
  it('survives a seed change', () => {
    const overrides = { '--ce-on-primary': '#123456' } as const;

    const before = resolvePalette(AMBER, overrides);
    const after = resolvePalette({ ...AMBER, primary: '#2E7D57' }, overrides);

    expect(before['--ce-on-primary']).toBe('#123456');
    expect(after['--ce-on-primary']).toBe('#123456');
    // ...while everything not overridden does follow the new seed.
    expect(after['--ce-chrome']).not.toBe(before['--ce-chrome']);
  });

  it('ignores unknown tokens and blank values', () => {
    const derived = derivePalette(AMBER);
    const out = applyOverrides(derived, {
      '--ce-not-a-token': '#ff0000',
      '--ce-on-primary': '   ',
    } as never);
    expect(out['--ce-on-primary']).toBe(derived['--ce-on-primary']);
    expect(out).toEqual(derived);
  });

  it('does not mutate the palette it is given', () => {
    const derived = derivePalette(AMBER);
    const copy = { ...derived };
    applyOverrides(derived, { '--ce-primary': '#000000' });
    expect(derived).toEqual(copy);
  });
});

describe('parseOverrides', () => {
  it('reads a well-formed blob', () => {
    expect(parseOverrides('{"--ce-on-primary":"#123456"}')).toEqual({
      '--ce-on-primary': '#123456',
    });
  });

  it('treats anything unparseable as no overrides', () => {
    // A corrupt row must never be able to take a community's colours down.
    for (const bad of ['', '   ', 'not json', '[]', 'null', '42', '"a string"']) {
      expect(parseOverrides(bad), bad).toEqual({});
    }
    expect(parseOverrides(null)).toEqual({});
    expect(parseOverrides(undefined)).toEqual({});
  });

  it('drops keys that are not palette tokens', () => {
    expect(parseOverrides('{"--evil":"x","--ce-primary":"#fff000"}')).toEqual({
      '--ce-primary': '#fff000',
    });
  });
});

describe('contrastWarnings', () => {
  // The app cannot render a dark page background yet: Material's surfaces stay
  // light while the derived ink flips to near-white, so body copy lands
  // white-on-cream. The palette screen has to say so, because the derivation
  // itself produces a perfectly self-consistent dark palette.
  it('flags a dark background as unsupported, not merely low-contrast', () => {
    const warnings = contrastWarnings(
      derivePalette({ primary: '#00d7e8', accent: '#7048e8', background: '#06101e' }),
    );
    const dark = warnings.find((w) => w.kind === 'unsupported');
    expect(dark).toBeDefined();
    expect(dark!.token).toBe('--ce-surface');
    expect(dark!.message).toContain('not supported yet');
  });

  it('does not flag a light background', () => {
    const warnings = contrastWarnings(derivePalette(AMBER));
    expect(warnings.some((w) => w.kind === 'unsupported')).toBe(false);
  });

  it('is silent on the seeded palette', () => {
    expect(contrastWarnings(derivePalette(AMBER))).toEqual([]);
  });

  it('flags an override that makes text unreadable', () => {
    // White on the seeded amber is 2.72:1 — precisely the pairing v2-11 exists
    // to stop being invisible, now reachable only by an admin choosing it.
    const palette = resolvePalette(AMBER, { '--ce-on-primary': '#ffffff' });
    const warnings = contrastWarnings(palette);

    expect(warnings.length).toBeGreaterThan(0);
    const primary = warnings.find((w) => w.token === '--ce-on-primary');
    expect(primary).toBeDefined();
    expect(primary!.ratio).toBeLessThan(AA_NORMAL);
    expect(primary!.message).toContain('hard to read');
  });

  it('names the foreground token, which is the one an admin can fix', () => {
    const palette = resolvePalette(AMBER, { '--ce-text': '#FBF7F0' });
    const warnings = contrastWarnings(palette);
    expect(warnings.some((w) => w.token === '--ce-text')).toBe(true);
    expect(warnings.some((w) => w.token === '--ce-surface')).toBe(false);
  });

  it('sorts worst first, so the screen leads with the biggest problem', () => {
    const palette = resolvePalette(AMBER, {
      '--ce-on-primary': '#C9A55A',
      '--ce-text': '#F5EFE4',
    });
    const warnings = contrastWarnings(palette);
    expect(warnings.length).toBeGreaterThan(1);
    for (let i = 1; i < warnings.length; i++) {
      expect(warnings[i].ratio).toBeGreaterThanOrEqual(warnings[i - 1].ratio);
    }
  });

  it('reports an unparseable override rather than skipping it', () => {
    // Silence here would read as "this palette is fine".
    const palette = resolvePalette(AMBER, { '--ce-on-primary': 'chartreuse' });
    expect(contrastWarnings(palette).some((w) => w.token === '--ce-on-primary')).toBe(true);
  });
});

describe('the derived palette as a whole', () => {
  it('reaches AA for every seed hue an admin can pick', () => {
    // Sweeping the hue circle with a plausible light ground: every derivation
    // that feeds body text or a button label has to come out readable, or the
    // "readable by construction" claim is only true for the colours we tried.
    for (let h = 0; h < 360; h += 15) {
      const seeds: PaletteSeeds = {
        primary: hueHex(h),
        accent: hueHex((h + 40) % 360),
        background: '#FDFAF5',
      };
      const p = resolvePalette(seeds);
      expect(contrastRatio(p['--ce-on-primary'], p['--ce-primary'])!, `h${h} on-primary`)
        .toBeGreaterThanOrEqual(AA_NORMAL);
      expect(contrastRatio(p['--ce-text'], p['--ce-surface'])!, `h${h} text`)
        .toBeGreaterThanOrEqual(AA_NORMAL);
      expect(contrastRatio(p['--ce-on-chrome'], p['--ce-chrome'])!, `h${h} on-chrome`)
        .toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });
});

/** A mid-lightness, saturated colour at hue `h` — what a brand colour looks like. */
function hueHex(h: number): string {
  const s = 0.7;
  const l = 0.5;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  const to = (v: number): string =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

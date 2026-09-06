import { describe, it, expect } from 'vitest';
import { PALETTE_PRESETS, presetByKey, presetForSeeds } from './palette-presets';
import { resolvePalette, contrastWarnings } from './palette';

describe('palette presets', () => {
  // The promise a preset makes: pick this and you do not have to think about
  // contrast. If one of these ever ships a combination the admin screen would
  // warn about, we shipped the warning to the person least able to act on it.
  it('every preset derives a palette with no contrast warnings', () => {
    for (const preset of PALETTE_PRESETS) {
      const warnings = contrastWarnings(resolvePalette(preset.seeds));
      expect(warnings.map((w) => w.message), preset.key).toEqual([]);
    }
  });

  it('has unique keys', () => {
    const keys = PALETTE_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps the seeded amber available, so an existing community can name what it has', () => {
    const amber = presetByKey('amber');
    expect(amber).not.toBeNull();
    expect(amber!.seeds.primary).toBe('#C9933A');
    expect(amber!.seeds.background).toBe('#FDFAF5');
  });

  it('resolves an unknown key to null rather than throwing', () => {
    expect(presetByKey('nope')).toBeNull();
    expect(presetByKey('')).toBeNull();
    expect(presetByKey(null)).toBeNull();
  });

  it('recognises its own presets from seeds alone', () => {
    // Why the screen needs no stored "which preset" field: the seeds are the
    // truth, and a stored choice could disagree with them after one edit.
    for (const preset of PALETTE_PRESETS) {
      expect(presetForSeeds(preset.seeds)?.key, preset.key).toBe(preset.key);
    }
  });

  it('reports no preset once an admin nudges a colour', () => {
    const forest = presetByKey('forest')!;
    expect(presetForSeeds({ ...forest.seeds, primary: '#2E7D58' })).toBeNull();
  });
});

// The preset palettes — tier one of the three-tier colour system.
//
// Most communities should stop here and never open a colour picker. A preset
// is nothing more than a named set of the same three seeds an admin could type
// by hand, so picking one is not a separate mode: it writes the seeds and
// everything derives exactly as it would otherwise. That is deliberate — a
// preset that was its own kind of thing would need its own override rules,
// its own preview path and its own migration when the token set changes.
//
// Every preset is held to the same contrast bar as a hand-picked palette by
// `palette-presets.spec.ts`, which fails the build if one of these ships a
// combination the admin screen would warn an admin about.

import type { PaletteSeeds } from './palette';

export interface PalettePreset {
  /** Stable identifier. Stored, so renaming the label is safe and this is not. */
  key: string;
  /** What the admin sees. */
  label: string;
  /** One line on where it suits, shown under the swatches. */
  description: string;
  seeds: PaletteSeeds;
}

export const PALETTE_PRESETS: readonly PalettePreset[] = [
  {
    key: 'amber',
    label: 'Amber',
    description: 'Warm gold on cream. The palette this app was built in.',
    seeds: { primary: '#C9933A', accent: '#B5762A', background: '#FDFAF5' },
  },
  {
    key: 'indigo',
    label: 'Indigo',
    description: 'Cool blue-violet. Reads as calm and civic.',
    seeds: { primary: '#4C5BD4', accent: '#6B4BA8', background: '#F7F7FB' },
  },
  {
    key: 'forest',
    label: 'Forest',
    description: 'Deep green. Outdoorsy without being loud.',
    seeds: { primary: '#2E7D57', accent: '#3F6B45', background: '#F5FAF6' },
  },
  {
    key: 'ocean',
    label: 'Ocean',
    description: 'Teal and slate blue. Fresh, works well with photography.',
    seeds: { primary: '#1F6F8B', accent: '#2B5F7A', background: '#F4F9FB' },
  },
  {
    key: 'plum',
    label: 'Plum',
    description: 'Purple with a warm edge. Distinctive without shouting.',
    seeds: { primary: '#7A3E8F', accent: '#9B4A6B', background: '#FAF5FB' },
  },
  {
    key: 'ember',
    label: 'Ember',
    description: 'Burnt orange and rust. Warm and appetising.',
    seeds: { primary: '#B5442E', accent: '#8F4A2A', background: '#FDF6F3' },
  },
  {
    key: 'slate',
    label: 'Slate',
    description: 'Near-neutral grey-blue. For a community that wants no colour opinion.',
    seeds: { primary: '#46566B', accent: '#5E6E85', background: '#F6F8FA' },
  },
] as const;

/** Look a preset up by its stored key. Unknown keys resolve to null, not a throw. */
export function presetByKey(key: string | null | undefined): PalettePreset | null {
  if (!key) return null;
  return PALETTE_PRESETS.find((p) => p.key === key) ?? null;
}

/**
 * Which preset a set of seeds corresponds to, or null if it matches none.
 *
 * The admin screen uses this to show a preset as selected after a reload
 * rather than storing the choice separately. Storing "which preset" alongside
 * the seeds would let the two disagree — an admin nudges one colour and the
 * screen still claims they are on Forest — and there is no way to tell which
 * of the two is the truth. The seeds are the truth; this is a lookup.
 */
export function presetForSeeds(seeds: PaletteSeeds): PalettePreset | null {
  const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
  return (
    PALETTE_PRESETS.find(
      (p) =>
        same(p.seeds.primary, seeds.primary) &&
        same(p.seeds.accent, seeds.accent) &&
        same(p.seeds.background, seeds.background),
    ) ?? null
  );
}

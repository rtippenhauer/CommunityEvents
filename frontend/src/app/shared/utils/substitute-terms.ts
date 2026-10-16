/**
 * The three words a note's tokens stand for. BrandConfigService satisfies it
 * (its signals are callable), and so does a plain stub in a spec.
 */
export interface TermSource {
  points: () => string;
  locationPluralLower: () => string;
  dinnerPluralLower: () => string;
}

/**
 * Shared release notes (see docs/RELEASE_NOTE_PIPELINE_SPEC.md) ship with
 * {{points}}/{{locations}}/{{events}} placeholder tokens instead of hardcoded
 * wording, so one note reads correctly in every community. The words come from
 * the branding payload of the community serving the page, so each community
 * reads its own terms. Instance-specific notes never contain these tokens, so
 * this is a no-op for them.
 *
 * Apply it everywhere a release's title or body is shown to members (v1 PR
 * #43: the login splash printed `{{events}}` raw because only the Updates page
 * substituted). There are no singular tokens, so notes are worded so a plural
 * fits. The admin release editor deliberately shows the raw copy.
 */
export function substituteTerms(content: string, brand: TermSource): string {
  return content
    .replace(/\{\{\s*points\s*\}\}/gi, brand.points())
    .replace(/\{\{\s*locations\s*\}\}/gi, brand.locationPluralLower())
    .replace(/\{\{\s*events\s*\}\}/gi, brand.dinnerPluralLower());
}

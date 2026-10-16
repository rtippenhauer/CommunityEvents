import { substituteTerms } from './substitute-terms';

// Placeholders must be swapped for this community's words wherever a release
// note is shown -- the login splash used to show raw {{events}} (v1 PR #43).
describe('substituteTerms', () => {
  const brand = {
    points: () => 'Bear Points',
    locationPluralLower: () => 'restaurants',
    dinnerPluralLower: () => 'dinners',
  };

  it('replaces every placeholder, with or without inner spaces, in any case', () => {
    expect(substituteTerms('Upcoming {{events}} at our {{ locations }} earn {{POINTS}}; more {{events}}.', brand)).toBe(
      'Upcoming dinners at our restaurants earn Bear Points; more dinners.',
    );
  });

  it("uses the serving community's own terms", () => {
    const other = { points: () => 'Stars', locationPluralLower: () => 'venues', dinnerPluralLower: () => 'meetups' };
    expect(substituteTerms('{{events}} at {{locations}} for {{points}}', other)).toBe('meetups at venues for Stars');
  });

  it('leaves text without placeholders alone', () => {
    expect(substituteTerms('<p>Hello {{name}}</p>', brand)).toBe('<p>Hello {{name}}</p>');
  });
});

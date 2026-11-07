import { describe, it, expect } from 'vitest';
import { preselectCityId } from './city-preselect.util';

describe('preselectCityId', () => {
  it('picks the default city when the community has several', () => {
    // The regression: both forms preselected only on length === 1, so a
    // two-city community opened every new event and venue on an empty
    // required field while a default sat in the database unread.
    const cities = [
      { id: 7, name: 'Cincinnati' },
      { id: 3, name: 'Dayton', isDefault: true },
    ];

    expect(preselectCityId(cities)).toBe(3);
  });

  it('picks the sole city when no default is marked', () => {
    expect(preselectCityId([{ id: 4 }])).toBe(4);
  });

  it('leaves the picker empty when several cities have no default between them', () => {
    // Guessing here is what is_default replaced: the lowest id and the lowest
    // name were two different answers, and renaming a city moved one of them.
    expect(preselectCityId([{ id: 1 }, { id: 2 }])).toBeNull();
  });

  it('never preselects a retired city, even as the only one in the list', () => {
    // `?include=` adds the row's own city back so an existing event can render
    // its value rather than going blank. That list has length 1, so the old
    // rule would have filed a NEW row under a city the admin stopped using.
    expect(preselectCityId([{ id: 9, isActive: false }])).toBeNull();
  });

  it('ignores a retired city when choosing among the active ones', () => {
    const cities = [
      { id: 9, isActive: false },
      { id: 5, isActive: true },
    ];

    expect(preselectCityId(cities)).toBe(5);
  });

  it('prefers an active default over a retired one', () => {
    // Retiring the default hands the marker on, so two should not coexist —
    // the unique index forbids it. Asserted because the fallback must not
    // depend on that holding.
    const cities = [
      { id: 9, isActive: false, isDefault: true },
      { id: 5, isActive: true, isDefault: true },
    ];

    expect(preselectCityId(cities)).toBe(5);
  });

  it('leaves the picker empty when there are no cities at all', () => {
    expect(preselectCityId([])).toBeNull();
  });
});

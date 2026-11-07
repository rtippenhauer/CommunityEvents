/**
 * The shape `/api/v1/cities` returns, narrowed to what choosing a default needs.
 *
 * Both form dialogs declare their own fuller `City`; this is structural, so
 * either satisfies it without importing from the other.
 */
export interface PreselectableCity {
  id: number;
  isActive?: boolean;
  isDefault?: boolean | null;
}

/**
 * Which city a NEW event or venue should open on, or null to leave the picker
 * empty.
 *
 * The community's default (`cities.is_default`, set at Admin → Cities) is the
 * answer an admin actually chose, so it wins. A single city is the same rule
 * where the answer is obvious, and is the fallback for a community holding no
 * marker — one with cities turned off is left unmarked deliberately, since
 * there is no destination to guess at.
 *
 * Both forms used to preselect only when `length === 1`, so a community with
 * two cities opened every new event and venue on an empty required field while
 * a default sat in the database unread.
 *
 * A retired city is never preselected. `?include=` adds one to the list so an
 * existing row can render its own value rather than going blank; filing a new
 * row under a city the admin has stopped using is a different thing entirely.
 */
export function preselectCityId(cities: readonly PreselectableCity[]): number | null {
  const selectable = cities.filter((c) => c.isActive !== false);
  const chosen =
    selectable.find((c) => c.isDefault === true) ??
    (selectable.length === 1 ? selectable[0] : undefined);
  return chosen?.id ?? null;
}

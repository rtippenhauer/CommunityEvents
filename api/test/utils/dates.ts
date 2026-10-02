/**
 * "Thirty days from now", computed the way the application computes it.
 *
 * Both of the places this is used add days with `setDate(+n)` on a local Date,
 * which advances the **calendar** day and leaves the wall-clock time alone. The
 * tests used to compare that against `Date.now() + n * 86_400_000`, which
 * advances by a fixed number of milliseconds. Those agree on most days and
 * differ by exactly an hour across a daylight-saving transition — so both specs
 * went red for the whole month before a changeover and then healed on their own,
 * which is the worst possible failure mode: a suite that is red for reasons
 * nobody can reproduce next week teaches people to wave failures through.
 *
 * Found on 2026-10-02, when "+30 days" first reached 2026-11-01.
 *
 * The application's behaviour is the correct one and is not what changed here:
 * an invite that expires in thirty days should expire on the same clock time
 * thirty calendar days later, not an hour earlier because the clocks went back.
 */
export function daysFromNowLocal(days: number): number {
  const target = new Date();
  target.setDate(target.getDate() + days);
  return target.getTime();
}

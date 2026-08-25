/**
 * What a community's email settings start as.
 *
 * One definition, because there are four places that need it and they had
 * already started to drift: the two tenant-creation paths, the dispatcher's
 * create-on-first-use, the admin screen's create-on-first-save, and the view
 * that answers for a community with no row at all.
 *
 * No credential is in here on purpose. A new community sends on the
 * deployment's env credentials until somebody gives it its own, so what this
 * seeds is the quota and the counters — the things that must be per-community
 * from the first message rather than shared.
 */
export const EMAIL_PROVIDER_DEFAULTS = {
  brevoEnabled: true,
  resendOverflowEnabled: false,
  brevoDailyLimit: 300,
  resendDailyLimit: 1000,
  brevoSentToday: 0,
  resendSentToday: 0,
} as const;

/** The same defaults with today's reset date, for an actual insert. */
export function newEmailProviderConfig(): typeof EMAIL_PROVIDER_DEFAULTS & { lastResetDate: Date } {
  return { ...EMAIL_PROVIDER_DEFAULTS, lastResetDate: new Date() };
}

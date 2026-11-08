import { copy, custom, drop, fk, type TablePlan } from '../plan-types';

/**
 * Accounts, configuration and the city model (REQ-IMPORT-01.3, REQ-CITIES-01).
 *
 * Ordered first because almost everything else carries a `user_id`. Within the
 * group the order is `cities` -> `users` -> everything hanging off a user, with
 * the two dependency cycles (`users` <-> `invites`, `users` <-> `announcements`)
 * closed by backfill passes rather than by ordering, since no order can satisfy
 * a cycle.
 */

/**
 * v1's two cities become two rows inside the one new tenant.
 *
 * This is the whole of v2-24's point: a city is a row, not a hostname. v1's
 * `subdomain` is dropped because `cincinnati.dinnerbears.com` and
 * `dayton.dinnerbears.com` are retired at cutover (Rob, 2026-10-14) and the
 * column does not exist in v2 — reintroducing one is a regression.
 */
export const citiesPlan: TablePlan = {
  source: 'cities',
  model: 'cities',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    name: copy('name'),
    subdomain: drop(
      'v2 has no subdomain: a city is a row, not a host (v2-24). The city ' +
        'subdomains are retired at cutover and nobody used them.',
    ),
    is_active: copy('isActive'),
    created_at: copy('createdAt'),
  },
  transform: (_row, ctx) => {
    // `is_default` has no source column: v1 had no notion of a default city, it
    // had a hostname. v2 needs one, because `resolveDefaultCityId` is the single
    // answer to where a new member lands and where the backfill files
    // everything.
    //
    // The lowest source id wins, which is Cincinnati — matching both v1's own
    // fallback (first city) and Rob's 2026-10-14 call that new members default
    // to Cincinnati. Deliberately **not** the lowest name: `resolveDefaultCityId`
    // is explicit that a rename must not move the default, and "Cincinnati"
    // only happens to sort first.
    //
    // Written as `true` or NULL and never `false` — it is the `root_marker`
    // pattern, where the unique index on (tenant_id, is_default) is what makes
    // "at most one default" a database constraint.
    const isFirst = ctx.ids.size('cities') === 0;
    return { action: 'write', data: { isDefault: isFirst ? true : null } };
  },
  note: 'First: users, locations, events, announcements and invites all carry a city.',
};

/**
 * Members. The table the cutover is really about, and the one with the two
 * columns that break silently if they are regenerated.
 */
export const usersPlan: TablePlan = {
  source: 'users',
  model: 'users',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    full_name: copy('fullName'),
    email: copy('email'),
    email_status: copy('emailStatus'),
    email_verified_at: copy('emailVerifiedAt'),
    password_hash: copy('passwordHash'),

    // Carried across rather than cleared. These are short-lived hashed tokens,
    // so the window in which one is useful is hours — but a member who
    // requested a reset the evening before cutover would otherwise find the
    // link in their inbox silently dead, and the column costs nothing.
    email_verification_token: copy('emailVerificationToken'),
    email_verification_expires_at: copy('emailVerificationExpiresAt'),
    password_reset_token: copy('passwordResetToken'),
    password_reset_expires_at: copy('passwordResetExpiresAt'),

    city_id: fk('cityId', 'cities', false),
    role: copy('role'),

    // v1's `is_automation_account` is v2's `is_service_account`, renamed in v2-6
    // for a reason that matters here: guards key on this column and never on
    // the role, because the role is deliberately mutable. Carrying the value is
    // what keeps v1's automation and Muse accounts out of the member directory
    // and the leaderboard.
    is_automation_account: copy('isServiceAccount'),

    has_membership: copy('hasMembership'),
    membership_expires_at: copy('membershipExpiresAt'),
    profile_photo_path: copy('profilePhotoPath'),
    status: copy('status'),

    // Both halves of the invite lineage are written by a backfill pass:
    // `users.invited_by` points within `users` and would be satisfiable by id
    // order, but `users.invite_id` points at `invites`, whose `created_by` and
    // `redeemed_by` point back at `users`. One cycle, so both columns are
    // deferred together rather than one being special-cased.
    invited_by: custom('Backfilled: users <-> invites cycle.'),
    invite_id: custom('Backfilled: users <-> invites cycle.'),
    invite_source: copy('inviteSource'),
    invite_source_name: copy('inviteSourceName'),

    last_login_at: copy('lastLoginAt'),
    login_count: copy('loginCount'),
    qualifying_login_count: copy('qualifyingLoginCount'),
    last_qualifying_login_at: copy('lastQualifyingLoginAt'),
    failed_login_attempts: copy('failedLoginAttempts'),
    login_locked_until: copy('loginLockedUntil'),
    last_failed_login_at: copy('lastFailedLoginAt'),

    // **Carried verbatim, never regenerated.** This is the identity inside an
    // iCal feed URL that 26 of 62 members have already pasted into Google or
    // Apple Calendar. `www.dinnerbears.com` survives as the tenant's host, so
    // the subscription keeps working if and only if the token still identifies
    // them — and nothing anywhere surfaces an error if it does not. The member
    // simply stops hearing from the app.
    calendar_token: copy('calendarToken'),

    calendar_rsvp_only: copy('calendarRsvpOnly'),

    // v2-24 replaced this enum with `user_city_preferences`, so the value is
    // read here and written as rows of a different table. See
    // `userCityPreferencesFromUsers`.
    calendar_city_filter: custom('Becomes user_city_preferences rows (v2-24).'),

    // v1's `none | city | all` narrowed to an on/off in v2-24: which cities it
    // covers now comes from `user_city_preferences`. `none` is off, both other
    // arms are on — so a member who had auto-invite off does not acquire it,
    // which REQ-IMPORT-01.3 asks for explicitly.
    calendar_auto_invite: custom("Enum -> boolean: 'none' is false, 'city'/'all' true."),

    selected_title: copy('selectedTitle'),

    // v1's releases are imported once as deployment setup, outside this script
    // (a global table — one list per deployment, not per community), so there
    // is no `releases` id map to resolve against. Left NULL, which reads as
    // "has seen nothing" and means every member is shown the 2.0 release note
    // at go-live. That is what `docs/CUTOVER_PLAN.md` wants to happen anyway.
    last_seen_release_id: drop(
      'releases is global and imported separately as deployment setup, so there ' +
        'is no map. NULL means every member sees the 2.0 note once at go-live.',
    ),
    last_seen_announcement_id: custom('Backfilled: users <-> announcements cycle.'),

    deleted_at: copy('deletedAt'),
    hard_delete_at: copy('hardDeleteAt'),
    created_at: copy('createdAt'),
    updated_at: copy('updatedAt'),
  },
  transform: (row) => {
    const autoInvite = row['calendar_auto_invite'];
    return {
      action: 'write',
      data: {
        calendarAutoInvite: autoInvite === 'city' || autoInvite === 'all',
        // v2 adds a watermark beside each `last_seen_*` id, because an id alone
        // re-announces a release the member already dismissed once an older one
        // becomes latest again. No id is being written for releases, and the
        // announcement id is backfilled together with its own watermark, so both
        // start NULL here.
        lastSeenReleaseAt: null,
        lastSeenAnnouncementAt: null,
      },
    };
  },
  note:
    'Carries calendar_token verbatim (26 of 62 live subscriptions) and ' +
    'deleted_at/hard_delete_at, without which v1 soft-deleted members return as active.',
};

/**
 * Soft-deleted members are imported, not excluded, and this is why.
 *
 * v1's inactivity sweep leaves them in the table with `deleted_at` set.
 * Excluding them orphans every RSVP, comment and rating they ever wrote;
 * importing them without the timestamps brings them back to life as active
 * members. Both columns are plain copies above — this note exists so the
 * requirement's third bullet is answered somewhere a reader will find it.
 */
export const SOFT_DELETE_NOTE =
  'Soft-deleted members import with deleted_at/hard_delete_at intact.';

export const oauthAccountsPlan: TablePlan = {
  source: 'oauth_accounts',
  model: 'oauth_accounts',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    user_id: fk('userId', 'users', true),
    provider: copy('provider'),
    provider_id: copy('providerId'),
    email: copy('email'),
    profile_url: copy('profileUrl'),
    created_at: copy('createdAt'),
  },
  note:
    'A linked Google or Facebook identity. Still valid after cutover only if the ' +
    'tenant brings the same OAuth app — per-tenant credentials, no platform fallback.',
};

/**
 * Device sessions. Imported as history; none of them can still authenticate,
 * because v2 signs its own JWTs with its own secret and `jwt_jti` is matched
 * against a token this deployment never issued.
 */
export const loginSessionsPlan: TablePlan = {
  source: 'login_sessions',
  model: 'login_sessions',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    user_id: fk('userId', 'users', true),
    jwt_jti: copy('jwtJti'),
    user_agent: copy('userAgent'),
    ip_address: copy('ipAddress'),
    country: copy('country'),
    city: copy('city'),
    is_active: copy('isActive'),
    last_active_at: copy('lastActiveAt'),
    created_at: copy('createdAt'),
  },
};

/**
 * Web push registrations, and the second column that must come across verbatim.
 *
 * `endpoint` is the registration the browser issued; same origin at cutover, so
 * the row stays valid. **Necessary and not sufficient**: a subscription is bound
 * to the `applicationServerKey` it was created with, so production must also
 * adopt v1's `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`. That is
 * deployment env, not data, and lives in the cutover checklist — all three of
 * these rows are dead without it and nothing reports an error.
 */
export const pushSubscriptionsPlan: TablePlan = {
  source: 'push_subscriptions',
  model: 'push_subscriptions',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    user_id: fk('userId', 'users', true),
    endpoint: copy('endpoint'),
    p256dh: copy('p256dh'),
    auth: copy('auth'),
    created_at: copy('createdAt'),
  },
  note: 'Requires production to inherit v1 VAPID keys — see docs/CUTOVER_PLAN.md.',
};

export const notificationPreferencesPlan: TablePlan = {
  source: 'notification_preferences',
  model: 'notification_preferences',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    user_id: fk('userId', 'users', true),
    email_invite: copy('emailInvite'),
    email_verification: copy('emailVerification'),
    email_password_reset: copy('emailPasswordReset'),
    email_password_changed: copy('emailPasswordChanged'),
    email_security_alert: copy('emailSecurityAlert'),
    email_event_published: copy('emailEventPublished'),
    email_rsvp_confirmation: copy('emailRsvpConfirmation'),
    email_event_reminder: copy('emailEventReminder'),
    email_account_deletion: copy('emailAccountDeletion'),
    email_reengagement: copy('emailReengagement'),
    push_event_published: copy('pushEventPublished'),
    push_event_reminder: copy('pushEventReminder'),
    push_announcement: copy('pushAnnouncement'),
    updated_at: copy('updatedAt'),
  },
  note: "Every opt-out is preserved; an import that reset these would re-mail people who left.",
};

export const notificationsPlan: TablePlan = {
  source: 'notifications',
  model: 'notifications',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    user_id: fk('userId', 'users', true),
    type: copy('type'),
    title: copy('title'),
    body: copy('body'),
    // Left as written. These are in-app paths (`/events/12`) whose ids are v1's,
    // so a deep link may land on the wrong row or none — but the alternative is
    // rewriting ids embedded in free text, which is guesswork against a column
    // with no schema. The inbox is historical; a stale link is a dead click,
    // where a wrongly rewritten one is a link to somebody else's content.
    action_url: copy('actionUrl'),
    is_read: copy('isRead'),
    created_at: copy('createdAt'),
    read_at: copy('readAt'),
  },
};

/**
 * The community's own branding, copy and feature flags.
 *
 * **Not named in REQ-IMPORT-01.3, and the import is broken without it.**
 * `app_config` became tenant-scoped in v2-6, so these rows are what make the
 * imported community look like DinnerBears rather than like a blank tenant:
 * terminology, home-page copy, the brand story, invite expiry, inactivity
 * thresholds, guest limits.
 *
 * Safe to import wholesale because v1 keeps no credential here — checked
 * against every `app_config` key v1's migrations seed. v2 states the rule
 * outright: these rows are served to unauthenticated visitors, so a credential
 * in one is a disclosure. Per-community credentials live in `tenant_secrets`,
 * which this import never writes.
 */
export const appConfigPlan: TablePlan = {
  source: 'app_config',
  model: 'app_config',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    config_key: copy('configKey'),
    config_value: copy('configValue'),
    description: copy('description'),
    updated_by: fk('updatedBy', 'users', false),
    updated_at: copy('updatedAt'),
  },
  note:
    'feature_cities is forced on afterwards (REQ-IMPORT-01.3): the data is ' +
    'city-bearing throughout, so importing with the flag off would hide a city on every row.',
};

export const invitesPlan: TablePlan = {
  source: 'invites',
  model: 'invites',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    token: copy('token'),
    type: copy('type'),
    created_by: fk('createdBy', 'users', false),
    city_id: fk('cityId', 'cities', false),
    event_id: fk('eventId', 'events', false),
    invite_flavor: copy('inviteFlavor'),

    // `facebook_group_config` is dropped in its entirety per REQ-CITIES-01.5 —
    // the table is gone, not just its city relation — so there is nothing to
    // remap this to. `campaign_facebook` invites still import with their type
    // and city; only the group pointer is lost.
    facebook_group_id: drop(
      'facebook_group_config is dropped entirely (REQ-CITIES-01.5). The invite ' +
        'keeps its type and city; only the group pointer goes.',
    ),

    bound_to_email: copy('boundToEmail'),
    bound_to_name: copy('boundToName'),
    redeemed_by: fk('redeemedBy', 'users', false),
    redeemed_at: copy('redeemedAt'),

    // v2 kept this column but never ported the table it points at: there is no
    // `event_guest_rsvps` model, and no v1 migration ever created the table
    // either, so there was never a row to point at. Written as NULL rather than
    // remapped — the preflight asserts the source table's absence.
    guest_rsvp_id: drop(
      'v2 has no event_guest_rsvps model and no v1 migration ever created the ' +
        'table. Nothing to remap; written as NULL.',
    ),

    expires_at: copy('expiresAt'),
    is_revoked: copy('isRevoked'),
    max_uses: copy('maxUses'),
    use_count: copy('useCount'),
    created_at: copy('createdAt'),
  },
  note: 'After events, because an invite may be bound to one. Lineage back into users is backfilled.',
};

/**
 * Muse's bearer tokens (v2-29).
 *
 * Imported hashed, as stored — so the integration keeps working across cutover
 * without reissuing. The scoping is what gives the token meaning in v2:
 * `api_tokens.tenant_id` is how `MuseTenantMiddleware` knows which community a
 * call belongs to, since an integration presents no cookie and the Host header
 * is deliberately not trusted for it.
 */
export const apiTokensPlan: TablePlan = {
  source: 'api_tokens',
  model: 'api_tokens',
  columns: {
    id: custom('Source id is recorded in the id map, never written.'),
    user_id: fk('userId', 'users', true),
    token_hash: copy('tokenHash'),
    token_prefix: copy('tokenPrefix'),
    expires_at: copy('expiresAt'),
    last_used_at: copy('lastUsedAt'),
    revoked_at: copy('revokedAt'),
    created_by: fk('createdBy', 'users', false),
    created_at: copy('createdAt'),
  },
};

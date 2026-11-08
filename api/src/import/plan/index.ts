import type { BackfillPass, ExcludedTable, TablePlan } from '../plan-types';
import {
  apiTokensPlan,
  appConfigPlan,
  citiesPlan,
  invitesPlan,
  loginSessionsPlan,
  notificationPreferencesPlan,
  notificationsPlan,
  oauthAccountsPlan,
  pushSubscriptionsPlan,
  usersPlan,
} from './accounts';
import {
  eventCommentRepliesPlan,
  eventCommentsPlan,
  eventFacebookLinksPlan,
  eventGuestLinksPlan,
  eventRsvpsPlan,
  eventsPlan,
  facebookAccountsPlan,
  facebookEventAttendeesPlan,
  locationPhotosPlan,
  locationRatingsPlan,
  locationsPlan,
} from './events';
import {
  achievementsPlan,
  announcementCommentsPlan,
  announcementsPlan,
  auditLogPlan,
  contentFlagsPlan,
  contentReportsPlan,
  customIconsPlan,
  emailProviderConfigPlan,
  facebookDeletionRequestsPlan,
  feedbackNotesPlan,
  feedbackPlan,
  feedbackUpvotesPlan,
  memberAchievementsPlan,
  memberPointsPlan,
} from './community';

/**
 * The DinnerBears import, in the order it runs (REQ-IMPORT-01.2).
 *
 * **This array is the dependency order**, and it is hand-ordered rather than
 * topologically sorted on purpose. A sort would produce *an* order that
 * satisfies the foreign keys, and nobody reading it afterwards could tell
 * whether a particular adjacency was required or incidental — which is the
 * question asked when a table is added. Here each table sits after the tables
 * it references, and `IdMap` turns any mistake into an immediate, named failure
 * rather than a bad foreign key, so the order is checked by running it.
 *
 * Two cycles cannot be ordered away and are closed by `BACKFILL_PASSES` below.
 */
export const TABLE_PLANS: readonly TablePlan[] = [
  // Geography first: users, locations, events, announcements and invites all
  // carry a city.
  citiesPlan,

  // Then people. Invite lineage is deferred — see the backfill passes.
  usersPlan,

  // Config, which records who last changed each row.
  appConfigPlan,
  emailProviderConfigPlan,

  // Everything that hangs off a user and nothing else.
  oauthAccountsPlan,
  loginSessionsPlan,
  pushSubscriptionsPlan,
  notificationPreferencesPlan,
  notificationsPlan,
  customIconsPlan,
  apiTokensPlan,

  // Venues, then dinners, then what happened at them.
  locationsPlan,
  locationPhotosPlan,
  eventsPlan,
  eventRsvpsPlan,
  eventGuestLinksPlan,
  eventCommentsPlan,
  eventCommentRepliesPlan,
  locationRatingsPlan,

  // The Facebook mirror (v2-29): a link needs its event, an attendee needs both
  // the event and the Facebook account.
  eventFacebookLinksPlan,
  facebookAccountsPlan,
  facebookEventAttendeesPlan,

  // Achievements after events, because a secret-dinner achievement names one.
  achievementsPlan,
  memberAchievementsPlan,
  memberPointsPlan,

  // Announcements before their comments; users.last_seen_announcement_id is
  // backfilled after both.
  announcementsPlan,
  announcementCommentsPlan,

  // Invites after events, because an invite may be bound to one.
  invitesPlan,

  // Feedback splits across two models — see feedbackPlan. Notes and upvotes
  // follow it so they can find their parent, or not.
  feedbackPlan,
  feedbackNotesPlan,
  feedbackUpvotesPlan,

  // Moderation last among the content tables: a report points at any of the
  // comment, reply, announcement and rating tables, so all four must exist.
  contentReportsPlan,
  contentFlagsPlan,

  // The audit log references users and nothing else, but goes last because it
  // is the record of everything above.
  auditLogPlan,

  // Global in v2, and the only imported table whose rows carry no tenant_id.
  facebookDeletionRequestsPlan,
];

/**
 * Source tables this import reads nothing from, each with its reason.
 *
 * Declared rather than simply left out, and the preflight treats an
 * **undeclared** table in the source database as drift that stops the run. A
 * table nobody has thought about looks exactly like a table somebody forgot,
 * and `facebook_group_config` is the proof: it is correct to drop it and it
 * would be a silent bug to drop it by accident.
 */
export const EXCLUDED_TABLES: readonly ExcludedTable[] = [
  {
    source: 'email_queue',
    reason:
      'Outbound send history. Excluded per REQ-IMPORT-01.3 — the queue is ' +
      'operational state, and importing pending rows would mail members about ' +
      'events that already happened.',
  },
  {
    source: 'email_suppressions',
    reason:
      'Global in v2 and already independent of any tenant: that an address ' +
      'hard-bounced is a property of the address, not of whoever mailed it. ' +
      'Re-mailing a dead address from a second tenant is what gets a sending ' +
      'domain blocked.',
  },
  {
    source: 'releases',
    reason:
      'Global — one list per deployment, shared by every community, which is why ' +
      "notes carry {{events}} tokens that render per community. v1's rows are " +
      'imported once as deployment setup, not per tenant: inside this script they ' +
      'would be re-imported for every future customer. Doing it separately also ' +
      'carries the real published_at dates, which a file-based importer cannot.',
  },
  {
    source: 'facebook_group_config',
    reason:
      'Dropped in its entirety per REQ-CITIES-01.5 — the table is gone in v2, not ' +
      'just its city relation, so there is nothing to migrate. campaign_facebook ' +
      'invites still import with their type and city.',
  },
  {
    source: 'avatar',
    reason:
      'Reference data seeded per deployment, and global in v2 — importing v1\'s set ' +
      'would add duplicates visible to every community. Members who picked a preset ' +
      'keep their profile_photo_path, which points at a file rather than at this row.',
  },
  {
    source: 'merch_config',
    reason:
      'Global in v2: a single row for the whole deployment. Importing it would ' +
      "point every community at DinnerBears' store. Set it by hand if the " +
      'deployment should carry it.',
  },

  // Documented in v1's docs/DATABASE_SCHEMA.md but created by no migration and
  // referenced by no entity or query. The preflight asserts they are absent: if
  // one turns up, v1 grew it after this was written and the import needs a
  // decision rather than a default.
  {
    source: 'event_guest_rsvps',
    reason:
      "In v1's schema doc only — no migration creates it and no v1 code reads it. " +
      'v2 has no model either, though it kept invites.guest_rsvp_id. Guest ' +
      'attendance survives on event_guest_links.attended.',
    expectedAbsent: true,
  },
  {
    source: 'password_reset_tokens',
    reason:
      "In v1's schema doc only — no migration creates it. v1 and v2 both carry " +
      'reset tokens as inline columns on users, which do import.',
    expectedAbsent: true,
  },
  {
    source: 'email_verification_tokens',
    reason:
      "In v1's schema doc only — no migration creates it. Same inline-column story " +
      'as password_reset_tokens.',
    expectedAbsent: true,
  },
  {
    source: 'release_feedback',
    reason:
      'Join table between releases and feedback. Releases are excluded here, and ' +
      'the feedback half would point at rows split across two v2 tables. Rebuilt ' +
      'with the release-notes import if it is wanted.',
  },
  {
    source: 'migrations',
    reason: "TypeORM's own migration ledger. Not data.",
  },
];

/**
 * Passes that run once every table is in, because they cannot run before.
 *
 * Two kinds, kept together because they share the same precondition: the maps
 * are complete. The cycle-closing passes write a column twice; the derived
 * passes write rows that have no source table at all.
 */
export const BACKFILL_PASSES: readonly BackfillPass[] = [
  {
    name: 'cities.default-marker',
    describe: 'Mark the default city, which v1 had no column for',
    run: async (ctx) => {
      // v1 answered "which city am I in" with the hostname, so it has no
      // default-city column. v2 needs one: `resolveDefaultCityId` is the single
      // answer to where a new member lands and where the city backfill would
      // file anything null.
      //
      // The **lowest source id** wins, which is Cincinnati — matching v1's own
      // fallback (the first city) and Rob's 2026-10-14 call that new members
      // default to Cincinnati. Deliberately not the lowest *name*:
      // `resolveDefaultCityId` is explicit that a rename must not move the
      // default, and "Cincinnati" only happens to sort first today.
      //
      // Written as `true`, never `false` — the `root_marker` pattern, where the
      // unique index on (tenant_id, is_default) is what makes "at most one
      // default per community" a database constraint rather than a convention.
      // Every other city keeps the NULL it was imported with, and MySQL permits
      // repeated NULLs in a unique index.
      const rows = await ctx.fetch('cities', ['id']);
      const lowest = rows
        .map((row) => Number(row['id']))
        .sort((a, b) => a - b)
        .find((id) => ctx.ids.resolve('cities', id, 'cities.default-marker') !== undefined);

      if (lowest === undefined) {
        ctx.note('No city was imported, so none could be marked default.');
        return 0;
      }
      if (ctx.dryRun) return 1;

      const newId = ctx.ids.resolve('cities', lowest, 'cities.default-marker');
      await ctx.update('cities', newId as number, { isDefault: true });
      return 1;
    },
  },

  {
    name: 'users.invite-lineage',
    describe: "Invite lineage: who invited whom, and which invite they redeemed",
    run: async (ctx) => {
      // The `users` <-> `invites` cycle. `invited_by` points within `users` and
      // would be satisfiable by id order on its own; `invite_id` points at
      // `invites`, whose `created_by` and `redeemed_by` point back. One cycle,
      // so both are deferred together rather than one being special-cased.
      const rows = await ctx.fetch('users', ['id', 'invited_by', 'invite_id']);
      let written = 0;

      for (const row of rows) {
        const newId = ctx.ids.resolve('users', Number(row['id']), 'users.invite-lineage');
        if (newId === undefined) continue;

        const invitedBy = ctx.ids.resolveNullable(
          'users',
          row['invited_by'] as number | null,
          'users.invited_by',
        );
        const inviteId = ctx.ids.resolveNullable(
          'invites',
          row['invite_id'] as number | null,
          'users.invite_id',
        );

        if (invitedBy.orphaned) {
          ctx.note(
            `users#${String(row['id'])}.invited_by points at user ` +
              `#${String(row['invited_by'])}, which was not imported. Written as NULL.`,
          );
        }
        if (inviteId.orphaned) {
          ctx.note(
            `users#${String(row['id'])}.invite_id points at invite ` +
              `#${String(row['invite_id'])}, which was not imported. Written as NULL.`,
          );
        }
        if (invitedBy.value === null && inviteId.value === null) continue;

        await ctx.update('users', newId, {
          invitedBy: invitedBy.value,
          inviteId: inviteId.value,
        });
        written += 1;
      }
      return written;
    },
  },

  {
    name: 'users.last-seen-announcement',
    describe: "Each member's login-splash watermark for announcements",
    run: async (ctx) => {
      // The `users` <-> `announcements` cycle, and the one place this import has
      // to write a column v1 does not have. v2 keeps a timestamp beside the id
      // because an id alone re-announces something the member already dismissed:
      // delete the newest announcement and an older one becomes latest, whose
      // different id reads as unseen. The watermark is taken from the
      // announcement the member had actually seen.
      const rows = await ctx.fetch('users', ['id', 'last_seen_announcement_id']);
      const announcements = await ctx.fetch('announcements', ['id', 'published_at', 'created_at']);
      const seenAt = new Map<number, unknown>(
        announcements.map((a) => [
          Number(a['id']),
          // published_at is NULL for a draft, which a member cannot have seen —
          // fall back to created_at rather than writing NULL, which would read
          // as "has seen nothing" and re-announce everything.
          a['published_at'] ?? a['created_at'],
        ]),
      );

      let written = 0;
      for (const row of rows) {
        const sourceId = row['last_seen_announcement_id'] as number | null;
        if (sourceId === null || sourceId === undefined) continue;

        const newUserId = ctx.ids.resolve('users', Number(row['id']), 'users.last-seen-announcement');
        if (newUserId === undefined) continue;

        const mapped = ctx.ids.resolveNullable(
          'announcements',
          sourceId,
          'users.last_seen_announcement_id',
        );
        if (mapped.value === null) {
          ctx.note(
            `users#${String(row['id'])}.last_seen_announcement_id points at announcement ` +
              `#${sourceId}, which was not imported. Written as NULL; the member sees the ` +
              'latest announcement once.',
          );
          continue;
        }

        await ctx.update('users', newUserId, {
          lastSeenAnnouncementId: mapped.value,
          lastSeenAnnouncementAt: seenAt.get(sourceId) ?? null,
        });
        written += 1;
      }
      return written;
    },
  },

  {
    name: 'user_city_preferences',
    describe: 'City preferences, derived from each member\'s legacy calendar filter',
    run: async (ctx) => {
      // **The one mapping in this import that departs from REQ-IMPORT-01.3 as
      // written, decided by Rob on 2026-11-07.**
      //
      // The requirement says each member's legacy city becomes one preference
      // row, "not All — this preserves their existing implicit filter". There is
      // no such implicit filter. v1's `CityService.currentCity()` resolves a city
      // from the *hostname*, and on `www.dinnerbears.com` — the host everybody
      // actually uses, with two active cities — it returns undefined, so the home
      // page requests events with no `cityId` at all. Every member sees both
      // cities today, and `calendar_city_filter` defaults to `all` as well.
      //
      // So one row per member would NARROW what all 62 see, on both the event
      // list and the calendar feed, with nothing shown to explain it. No rows
      // means All, which is what they see now.
      //
      // The exception is a member who set `calendar_city_filter = 'city'`: that
      // is the only explicit city choice v1 offered, and one row for their
      // `city_id` keeps it. Their event list widens where it was never narrow,
      // which is the closest a single set can come to an answer v1 recorded
      // per-question.
      const rows = await ctx.fetch('users', ['id', 'city_id', 'calendar_city_filter']);
      let written = 0;
      let allCount = 0;

      for (const row of rows) {
        if (row['calendar_city_filter'] !== 'city') {
          allCount += 1;
          continue;
        }

        const newUserId = ctx.ids.resolve('users', Number(row['id']), 'user_city_preferences.user_id');
        if (newUserId === undefined) continue;

        const cityId = ctx.ids.resolveNullable(
          'cities',
          row['city_id'] as number | null,
          'user_city_preferences.city_id',
        );
        if (cityId.value === null) {
          ctx.note(
            `users#${String(row['id'])} chose city-only calendar but has no importable ` +
              'city, so no preference row was written. The member sees every city.',
          );
          continue;
        }

        await ctx.create('user_city_preferences', { userId: newUserId, cityId: cityId.value });
        written += 1;
      }

      ctx.note(
        `${written} member(s) had calendar_city_filter='city' and got one preference row; ` +
          `${allCount} kept every city (no rows), which is what they see on v1 today.`,
      );
      return written;
    },
  },

  {
    name: 'app_config.feature_cities',
    describe: 'Switch feature_cities on for the imported community',
    run: async (ctx) => {
      // REQ-IMPORT-01.3: the import turns the flag on, because the data is
      // city-bearing throughout and importing with it off would hide a city on
      // every row.
      //
      // Written directly rather than through the admin toggle on purpose. The
      // toggle is asymmetric — switching it on *backfills* every null city to
      // the default — and every imported row already carries a real city, so
      // running the backfill would at best be a no-op and at worst refile rows
      // whose city failed to resolve. REQ-CITIES-01.6: no backfill runs.
      if (ctx.dryRun) return 1;
      await ctx.upsert(
        'app_config',
        { configKey: 'feature_cities' },
        {
          configKey: 'feature_cities',
          configValue: 'true',
          description: 'Set by the DinnerBears import: this community meets in more than one city.',
        },
      );
      return 1;
    },
  },
];

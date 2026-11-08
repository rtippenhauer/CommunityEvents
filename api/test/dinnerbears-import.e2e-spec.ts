import { INestApplication } from '@nestjs/common';
import { createTestApp, truncateAllTables } from './utils/test-app';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { runUnscoped, runWithTenant } from '../src/common/tenant/tenant-store';
import { TEST_TENANT_ID } from './setup-env';
import { seedCity, seedLocation, seedUser } from './utils/seed';
import { EventStatus } from '../src/database/enums';
import { createV1Fixture, type V1Fixture } from './fixtures/v1-source';
import { runImport, type RunReport } from '../src/import/runner';
import { TABLE_PLANS } from '../src/import/plan';
import { loadTargetSchema } from '../src/import/target-schema';
import { SourceReader } from '../src/import/source-reader';
import { preflight } from '../src/import/preflight';
import { validate } from '../src/import/validate';

/**
 * v2-25 (REQ-IMPORT-01), asserted end to end against a real v1-shaped
 * database.
 *
 * The unit specs cover the remapping logic and the plan's shape. What only an
 * integration test can answer is whether the thing actually runs: whether the
 * plan's order survives real foreign keys, whether the scoping extension puts
 * every row in the new community, and whether dry-run mode really writes
 * nothing. Those are the three the definition of done names.
 *
 * The fixture source database is built from `V1_SCHEMA`, so it has all 43 of
 * v1's tables and the preflight passes against it exactly as it would against
 * the real thing — which also means this file exercises the preflight rather
 * than skipping past it.
 */
describe('DinnerBears import (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let source: V1Fixture;

  const SLUG = 'dinnerbears';
  const DOMAIN = 'dinnerbears.example.test';

  // Source ids, so the assertions can say "not this one" about a remapped key.
  let cincinnatiId: number;
  let daytonId: number;
  let adminId: number;
  let memberId: number;
  let cityOnlyMemberId: number;
  let deletedMemberId: number;
  let eventId: number;
  let locationId: number;
  let achievementId: number;
  let commentId: number;

  const CALENDAR_TOKEN = 'b4f1c2d3-e4f5-6789-abcd-ef0123456789';

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    source = await createV1Fixture();
    await seedV1();
  }, 60_000);

  afterAll(async () => {
    await source.close();
    await source.drop();
    await app.close();
  });

  /**
   * A small but representative v1 community: two cities, four members with
   * deliberately different shapes, one dinner with an RSVP and a comment, an
   * earned achievement, and one feedback ticket of each category.
   *
   * Every row here exists to make one assertion possible. The soft-deleted
   * member is the requirement's third bullet; the `calendar_city_filter='city'`
   * member is the decision that departs from REQ-IMPORT-01.3; the orphaned
   * RSVP is the skip-and-report path.
   */
  async function seedV1(): Promise<void> {
    cincinnatiId = await source.insert('cities', {
      name: 'Cincinnati',
      subdomain: 'cincinnati',
      is_active: 1,
      created_at: '2024-01-01 00:00:00',
    });
    daytonId = await source.insert('cities', {
      name: 'Dayton',
      subdomain: 'dayton',
      is_active: 1,
      created_at: '2024-01-02 00:00:00',
    });

    adminId = await source.insert('users', {
      full_name: 'Rob Admin',
      email: 'admin@dinnerbears.test',
      email_status: 'active',
      role: 'admin',
      status: 'active',
      city_id: cincinnatiId,
      is_automation_account: 0,
      calendar_city_filter: 'all',
      calendar_auto_invite: 'all',
      calendar_rsvp_only: 0,
      login_count: 12,
      created_at: '2024-02-01 00:00:00',
      updated_at: '2024-02-01 00:00:00',
    });

    memberId = await source.insert('users', {
      full_name: 'Casey Member',
      email: 'casey@dinnerbears.test',
      email_status: 'active',
      role: 'member',
      status: 'active',
      city_id: cincinnatiId,
      is_automation_account: 0,
      // The column whose loss is silent and member-visible.
      calendar_token: CALENDAR_TOKEN,
      calendar_city_filter: 'all',
      calendar_auto_invite: 'none',
      calendar_rsvp_only: 0,
      login_count: 3,
      created_at: '2024-03-01 00:00:00',
      updated_at: '2024-03-01 00:00:00',
    });

    cityOnlyMemberId = await source.insert('users', {
      full_name: 'Dana Dayton',
      email: 'dana@dinnerbears.test',
      email_status: 'active',
      role: 'member',
      status: 'active',
      city_id: daytonId,
      is_automation_account: 0,
      // The only explicit city choice v1 offered.
      calendar_city_filter: 'city',
      calendar_auto_invite: 'city',
      calendar_rsvp_only: 0,
      login_count: 1,
      created_at: '2024-04-01 00:00:00',
      updated_at: '2024-04-01 00:00:00',
    });

    deletedMemberId = await source.insert('users', {
      full_name: 'Gone Member',
      email: 'gone@dinnerbears.test',
      email_status: 'unsubscribed',
      role: 'member',
      status: 'deleted',
      city_id: cincinnatiId,
      is_automation_account: 0,
      calendar_city_filter: 'all',
      calendar_auto_invite: 'none',
      calendar_rsvp_only: 0,
      deleted_at: '2025-01-01 00:00:00',
      hard_delete_at: '2025-01-31 00:00:00',
      created_at: '2024-05-01 00:00:00',
      updated_at: '2025-01-01 00:00:00',
    });

    // Invite lineage: the member was invited by the admin. Tests the
    // users <-> invites cycle and its backfill pass.
    const inviteId = await source.insert('invites', {
      token: 'invite-token-1',
      type: 'member',
      created_by: adminId,
      city_id: cincinnatiId,
      invite_flavor: 'member',
      // NOT NULL in both schemas, so a row without it is unwritable — the
      // import reports that precisely rather than letting Prisma blame a
      // missing nested relation several fields away.
      expires_at: '2024-02-22 00:00:00',
      is_revoked: 0,
      max_uses: 1,
      use_count: 1,
      redeemed_by: memberId,
      redeemed_at: '2024-03-01 00:00:00',
      created_at: '2024-02-15 00:00:00',
    });
    // Written as a second step because v1's schema has a cycle here:
    // `users.invite_id` points at a row of `invites` whose `created_by` points
    // back at `users`. The import closes the same cycle with a backfill pass,
    // for the same reason a fixture cannot write both halves in one insert.
    await source.update('users', memberId, {
      invited_by: adminId,
      invite_id: inviteId,
      invite_source: 'direct',
    });

    await source.insert('audit_log', {
      user_id: adminId,
      action: 'invite.create',
      entity_type: 'invite',
      entity_id: inviteId,
      created_at: '2024-02-15 00:00:00',
    });

    // A nullable foreign key pointing at a user that is not in the source --
    // v1 hard-deleted accounts and left the audit trail behind. The row is
    // still imported; only the column is blanked. See the dry-run test below.
    await source.insert('audit_log', {
      user_id: 999_999,
      action: 'user.delete',
      entity_type: 'user',
      entity_id: 999_999,
      created_at: '2024-02-16 00:00:00',
    });

    locationId = await source.insert('locations', {
      name: 'The Test Kitchen',
      address: '1 Main St',
      lat: '39.1031000',
      lng: '-84.5120000',
      city_id: cincinnatiId,
      is_active: 1,
      is_private: 0,
      is_residence: 0,
      created_by: adminId,
      moderator_notes: 'Ask for the back room.',
      contact_name: 'Private Contact',
      created_at: '2024-02-20 00:00:00',
      updated_at: '2024-02-20 00:00:00',
    });

    eventId = await source.insert('events', {
      city_id: cincinnatiId,
      location_id: locationId,
      location_name: 'The Test Kitchen',
      location_address: '1 Main St',
      title: 'March Dinner',
      description: 'A dinner.',
      event_date: '2026-03-14',
      event_time: '19:00:00',
      status: 'published',
      is_secret: 0,
      published_at: '2026-02-01 00:00:00',
      created_by: adminId,
      reservation_confirmed: 0,
      reservation_seats_email_sent: 0,
      created_at: '2026-02-01 00:00:00',
      updated_at: '2026-02-01 00:00:00',
    });

    await source.insert('event_rsvps', {
      event_id: eventId,
      user_id: memberId,
      status: 'going',
      additional_guests: 1,
      guest_names: JSON.stringify(['A Guest']),
      source: 'member',
      attended: 1,
      is_walkin: 0,
      from_other_city: 0,
      created_at: '2026-02-02 00:00:00',
      updated_at: '2026-02-02 00:00:00',
    });

    // An orphan: an RSVP whose event was hard-deleted. The skip-and-report
    // path, which real v1 data exercises and which must not stop the import.
    await source.insert('event_rsvps', {
      event_id: 999_999,
      user_id: memberId,
      status: 'going',
      source: 'member',
      created_at: '2026-02-02 00:00:00',
      updated_at: '2026-02-02 00:00:00',
    });

    commentId = await source.insert('event_comments', {
      event_id: eventId,
      member_id: memberId,
      body: 'Looking forward to it.',
      created_at: '2026-02-03 00:00:00',
    });
    await source.insert('event_comment_replies', {
      comment_id: commentId,
      member_id: adminId,
      body: 'Me too.',
      created_at: '2026-02-03 01:00:00',
    });

    await source.insert('location_ratings', {
      member_id: memberId,
      event_id: eventId,
      location_id: locationId,
      food: 5,
      service: 4,
      value_rating: 4,
      noise: 2,
      comment: 'Good.',
      created_at: '2026-03-15 00:00:00',
      updated_at: '2026-03-15 00:00:00',
    });

    achievementId = await source.insert('achievements', {
      key: 'first_dinner',
      name: 'First Dinner',
      description: 'Attended a first dinner.',
      progress_type: 'attendance',
      progress_target: 1,
      points: 10,
      is_secret: 0,
      created_at: '2024-01-01 00:00:00',
    });
    await source.insert('member_achievements', {
      member_id: memberId,
      achievement_id: achievementId,
      earned_at: '2026-03-15 00:00:00',
    });
    await source.insert('member_points', {
      user_id: memberId,
      point_type: 'attendance',
      reference_id: eventId,
      points: 10,
      awarded_at: '2026-03-15 00:00:00',
    });

    const announcementId = await source.insert('announcements', {
      title: 'Welcome',
      body: 'Hello all.',
      city_id: cincinnatiId,
      status: 'published',
      published_at: '2024-02-01 00:00:00',
      created_by: adminId,
      created_at: '2024-02-01 00:00:00',
      updated_at: '2024-02-01 00:00:00',
    });
    await source.insert('announcement_comments', {
      announcement_id: announcementId,
      user_id: memberId,
      body: 'Hi.',
      created_at: '2024-02-02 00:00:00',
    });
    // The users <-> announcements cycle.
    await source.insert('content_reports', {
      reporter_id: memberId,
      content_type: 'event_comment',
      content_id: commentId,
      reason: 'spam',
      status: 'reviewed',
      reviewed_by: adminId,
      reviewed_at: '2026-02-04 00:00:00',
      created_at: '2026-02-03 12:00:00',
    });

    // One ticket of each category: the split Rob chose. The comment keeps its
    // note and upvote; the bug and feature request do not, because
    // system_reports has nowhere to put them.
    const commentTicket = await source.insert('feedback', {
      user_id: memberId,
      title: 'Love the app',
      category: 'comment',
      body: 'Really nice.',
      status: 'open',
      is_private: 0,
      upvote_count: 1,
      created_at: '2026-01-01 00:00:00',
      updated_at: '2026-01-01 00:00:00',
    });
    const bugTicket = await source.insert('feedback', {
      user_id: memberId,
      title: 'RSVP button broken',
      category: 'bug',
      body: 'Does nothing.',
      status: 'open',
      is_private: 0,
      upvote_count: 2,
      created_at: '2026-01-02 00:00:00',
      updated_at: '2026-01-02 00:00:00',
    });
    await source.insert('feedback', {
      user_id: memberId,
      // Nullable in v1, NOT NULL in system_reports — the derived-title path.
      title: null,
      category: 'feature_request',
      body: 'Please add a dark mode toggle to the settings page.',
      status: 'open',
      is_private: 0,
      upvote_count: 0,
      created_at: '2026-01-03 00:00:00',
      updated_at: '2026-01-03 00:00:00',
    });
    await source.insert('feedback_notes', {
      feedback_id: commentTicket,
      author_id: adminId,
      content: 'Thanks!',
      is_admin_only: 0,
      created_at: '2026-01-01 01:00:00',
    });
    await source.insert('feedback_upvotes', {
      feedback_id: commentTicket,
      member_id: adminId,
      created_at: '2026-01-01 02:00:00',
    });
    // Both of these must be skipped: their parent becomes a system_reports row.
    await source.insert('feedback_notes', {
      feedback_id: bugTicket,
      author_id: adminId,
      content: 'Reproduced.',
      is_admin_only: 1,
      created_at: '2026-01-02 01:00:00',
    });
    await source.insert('feedback_upvotes', {
      feedback_id: bugTicket,
      member_id: cityOnlyMemberId,
      created_at: '2026-01-02 02:00:00',
    });

    await source.insert('app_config', {
      config_key: 'brand_name',
      config_value: 'Dinner Bears',
      description: 'The community name.',
      updated_by: adminId,
      updated_at: '2024-01-01 00:00:00',
    });
    await source.insert('app_config', {
      config_key: 'feature_leaderboard',
      config_value: 'true',
      updated_at: '2024-01-01 00:00:00',
    });

    await source.insert('email_provider_config', {
      brevo_enabled: 1,
      resend_overflow_enabled: 1,
      brevo_daily_limit: 300,
      resend_daily_limit: 100,
      brevo_sent_today: 7,
      resend_sent_today: 0,
      last_reset_date: '2026-11-07',
      brevo_api_key: 'xkeysib-live-secret',
      resend_api_key: 're_live_secret',
      brevo_from_email: 'hello@dinnerbears.com',
      brevo_from_name: 'Dinner Bears',
      tmpl_invite: 12,
      tmpl_event_published: 14,
      updated_at: '2026-11-01 00:00:00',
    });

    await source.insert('push_subscriptions', {
      user_id: memberId,
      endpoint: 'https://push.example.test/abc123',
      p256dh: 'key',
      auth: 'auth',
      created_at: '2026-01-01 00:00:00',
    });
    await source.insert('notification_preferences', {
      user_id: memberId,
      email_invite: 1,
      email_event_published: 0,
      push_event_published: 1,
      updated_at: '2026-01-01 00:00:00',
    });
    await source.insert('oauth_accounts', {
      user_id: adminId,
      provider: 'google',
      provider_id: 'google-123',
      email: 'admin@dinnerbears.test',
      created_at: '2024-02-01 00:00:00',
    });
  }

  /** The import, with the tenant torn down first so each run starts clean. */
  async function importOnce(
    overrides: { dryRun?: boolean; withEmailCredentials?: boolean } = {},
  ): Promise<RunReport> {
    const reader = await SourceReader.open(source.url);
    try {
      return await runImport(prisma, reader, {
        slug: SLUG,
        domain: DOMAIN,
        dryRun: overrides.dryRun ?? false,
        withEmailCredentials: overrides.withEmailCredentials ?? false,
      });
    } finally {
      await reader.close();
    }
  }

  describe('the plan against the target schema', () => {
    it('never marks a foreign key nullable that the target column requires', async () => {
      // The mismatch this catches does not fail cleanly. Prisma rejects `null`
      // for a required relation by switching to the *checked* create input, and
      // the error then asks for a nested `creator: { connect: ... }` — which
      // reads as a bug in how the import writes rows rather than as one wrong
      // `required` flag in the plan.
      //
      // Nullability is not in Prisma 7's runtime DMMF, so this is checked
      // against the database's own information_schema. The reverse direction is
      // deliberately allowed: a rule marked required against a nullable column
      // is merely stricter than it needs to be, and skips a row where it could
      // have written a null.
      const target = await loadTargetSchema(prisma);
      const wrong: string[] = [];

      for (const plan of TABLE_PLANS) {
        if (!plan.model) continue;
        for (const [column, rule] of Object.entries(plan.columns)) {
          if (rule.kind !== 'fk' || rule.required) continue;
          const shape = target.get(plan.model)?.get(rule.field);
          if (shape && !shape.nullable) {
            wrong.push(`${plan.source}.${column} -> ${plan.model}.${rule.field} is NOT NULL`);
          }
        }
      }

      expect(wrong).toEqual([]);
    });
  });

  describe('the preflight', () => {
    it('passes against a real v1-shaped database', async () => {
      // Not a formality: this is the check that would refuse the run if v1 had
      // grown a column, and the fixture is built from the same schema the plan
      // is written against.
      const reader = await SourceReader.open(source.url);
      try {
        const result = preflight(await reader.describe());
        expect(result.findings.filter((f) => f.severity === 'error')).toEqual([]);
        expect(result.ok).toBe(true);
      } finally {
        await reader.close();
      }
    });

    it('refuses a credential that can write to the source', async () => {
      // REQ-IMPORT-01.1 asks for a read-only connection, and a connection
      // string saying so is not the same as a credential that is. The fixture's
      // credential is root, so this asserts the guard fires rather than that it
      // exists.
      const reader = await SourceReader.open(source.url);
      try {
        await expect(reader.assertReadOnly()).rejects.toThrow(
          /can write to .* Grant SELECT only/s,
        );
      } finally {
        await reader.close();
      }
    });
  });

  describe('dry-run mode', () => {
    beforeAll(async () => {
      await truncateAllTables(prisma);
    });

    it('writes nothing at all', async () => {
      // REQ-IMPORT-01.4, verified by row counts before and after rather than by
      // trusting the flag.
      const before = await runUnscoped('counting before the dry run', async () => ({
        tenants: await prisma.tenants.count(),
        users: await prisma.users.count(),
        events: await prisma.events.count(),
      }));

      const report = await importOnce({ dryRun: true });

      const after = await runUnscoped('counting after the dry run', async () => ({
        tenants: await prisma.tenants.count(),
        users: await prisma.users.count(),
        events: await prisma.events.count(),
      }));

      expect(after).toEqual(before);
      expect(report.dryRun).toBe(true);
      expect(report.tenantId).toBeNull();
    });

    it('reports accurate counts anyway', async () => {
      // The counts are the whole point: the operator reads them before pointing
      // the script at anything real, so a dry run that under-reports is worse
      // than no dry run.
      const report = await importOnce({ dryRun: true });
      const byTable = new Map(report.tables.map((t) => [t.source, t]));

      expect(byTable.get('cities')).toMatchObject({ sourceRows: 2, imported: 2 });
      expect(byTable.get('users')).toMatchObject({ sourceRows: 4, imported: 4 });
      expect(byTable.get('events')).toMatchObject({ sourceRows: 1, imported: 1 });
      expect(byTable.get('feedback')).toMatchObject({ sourceRows: 3, imported: 3 });
    });

    it('resolves foreign keys past the first table', async () => {
      // The id map is populated on a dry run too. Without that, every table
      // after the first would report its whole contents as orphaned and the
      // counts would be meaningless.
      const report = await importOnce({ dryRun: true });
      const rsvps = report.tables.find((t) => t.source === 'event_rsvps');

      expect(rsvps?.imported).toBe(1);
      expect(rsvps?.skipped).toEqual([
        {
          reason: 'event_rsvps.event_id points at events#999999, which was not imported',
          count: 1,
        },
      ]);
    });

    it('counts a blanked nullable key apart from a skipped row', async () => {
      // These were one number once, and the live community showed why they
      // cannot be: 32 events in, 32 written, 14 with an orphaned reservation
      // coordinator. `imported + skipped` came to 46 against 32 source rows and
      // validation failed a correct import.
      const report = await importOnce({ dryRun: true });
      const audit = report.tables.find((t) => t.source === 'audit_log');

      expect(audit).toMatchObject({ sourceRows: 2, imported: 2, skipped: [] });
      expect(audit?.nulled).toEqual([
        {
          reason:
            'audit_log.user_id points at users#999999, which was not imported; written as NULL',
          count: 1,
        },
      ]);
    });

    it('closes the arithmetic on every table', async () => {
      // The property validation asserts. Stated here as well, because the
      // failure it catches is an import that lost rows without saying so.
      const report = await importOnce({ dryRun: true });
      for (const table of report.tables) {
        const skipped = table.skipped.reduce((sum, s) => sum + s.count, 0);
        expect(table.imported + skipped, table.source).toBe(table.sourceRows);
      }
    });
  });

  describe('a real import', () => {
    let report: RunReport;
    let tenantId: number;

    beforeAll(async () => {
      await truncateAllTables(prisma);

      // Give the target database rows of its own before importing, which is
      // the real situation: production holds the root tenant, its admin and
      // its city before the import runs.
      //
      // Without this the test is weaker than it looks. Both databases start
      // their auto-increment at 1, so source id 1 maps to new id 1 and a plain
      // copy of a foreign key is indistinguishable from a correct remap —
      // "every FK is rewritten" would pass against code that rewrote nothing.
      // Offsetting the counters is what makes the assertion mean something, and
      // it gives the isolation checks a neighbour to be isolated from.
      await runWithTenant(TEST_TENANT_ID, async () => {
        const city = await seedCity(prisma, { name: 'Root City' });
        for (let i = 0; i < 5; i += 1) {
          await seedUser(prisma, city.id, { email: `root-neighbour-${i}@example.test` });
        }
        const location = await seedLocation(prisma, city.id);
        const author = await prisma.users.findFirstOrThrow();
        const event = await prisma.events.create({
          data: {
            cityId: city.id,
            locationId: location.id,
            locationName: location.name,
            locationAddress: '2 Other St',
            title: "Another community's dinner",
            eventDate: new Date('2026-05-01T00:00:00Z'),
            eventTime: new Date('1970-01-01T18:00:00Z'),
            status: EventStatus.PUBLISHED,
            createdById: author.id,
          },
        });
        // One row in each of the other two tables whose remapped ids are
        // asserted on, for the same offsetting reason.
        await prisma.achievements.create({
          data: {
            key: 'root_only_achievement',
            name: 'Root Only',
            description: 'Belongs to the neighbouring community.',
            progressType: 'attendance',
            progressTarget: 1,
            points: 1,
          },
        });
        await prisma.event_comments.create({
          data: { eventId: event.id, memberId: author.id, body: "Another community's comment" },
        });
      });

      report = await importOnce();
      tenantId = report.tenantId as number;
      if (process.env.IMPORT_DEBUG) {
        const { formatRunReport } = await import('../src/import/report');
        console.log(formatRunReport(report));
      }
    }, 60_000);

    it('creates a non-root tenant', async () => {
      // Never root: root is the platform's own community and bootstrap owns it.
      const tenant = await runUnscoped('reading the imported tenant', async () =>
        prisma.tenants.findFirst({ where: { slug: SLUG } }),
      );

      expect(tenant).toMatchObject({ slug: SLUG, domain: DOMAIN, isRoot: false, rootMarker: null });
      expect(tenant?.id).toBe(tenantId);
      expect(tenantId).not.toBe(TEST_TENANT_ID);
    });

    it('puts every row inside that tenant and nowhere else', async () => {
      // The check REQ-IMPORT-01.5 ends on, and the failure this whole import is
      // shaped to avoid: a foreign key into another community reads as valid to
      // MySQL and renders as somebody else's content.
      const inside = await runWithTenant(tenantId, async () => ({
        users: await prisma.users.count(),
        events: await prisma.events.count(),
        cities: await prisma.cities.count(),
      }));
      const inTestTenant = await runWithTenant(TEST_TENANT_ID, async () => ({
        users: await prisma.users.count(),
        events: await prisma.events.count(),
        cities: await prisma.cities.count(),
      }));

      expect(inside).toEqual({ users: 4, events: 1, cities: 2 });
      // The neighbour community is untouched: exactly the rows the beforeAll
      // gave it, and none of the import's.
      expect(inTestTenant).toEqual({ users: 5, events: 1, cities: 1 });
    });

    it('remaps every foreign key rather than copying it', async () => {
      const rsvp = await runWithTenant(tenantId, async () =>
        prisma.event_rsvps.findFirst({ include: { event: true, user: true } }),
      );

      expect(rsvp?.event).toBeTruthy();
      expect(rsvp?.user).toBeTruthy();
      expect(rsvp?.event?.title).toBe('March Dinner');
      expect(rsvp?.user?.email).toBe('casey@dinnerbears.test');
      // The source ids are almost certainly taken in the target database, which
      // is the whole reason for the remapping.
      expect(rsvp?.eventId).not.toBe(eventId);
      expect(rsvp?.userId).not.toBe(memberId);
    });

    it('preserves calendar_token verbatim', async () => {
      // 26 of 62 real members have a live iCal subscription containing this
      // token. Regenerating it stops their calendars refreshing with no error
      // shown to anyone.
      const member = await runWithTenant(tenantId, async () =>
        prisma.users.findFirst({ where: { email: 'casey@dinnerbears.test' } }),
      );

      expect(member?.calendarToken).toBe(CALENDAR_TOKEN);
    });

    it('preserves the push endpoint verbatim', async () => {
      const subscription = await runWithTenant(tenantId, async () =>
        prisma.push_subscriptions.findFirst(),
      );

      expect(subscription?.endpoint).toBe('https://push.example.test/abc123');
    });

    it('imports soft-deleted members with their timestamps', async () => {
      // Without the timestamps they come back to life as active members;
      // without the rows their RSVPs and comments lose their FK target.
      const gone = await runWithTenant(tenantId, async () =>
        prisma.users.findFirst({ where: { email: 'gone@dinnerbears.test' } }),
      );

      expect(gone?.status).toBe('deleted');
      expect(gone?.deletedAt).toBeInstanceOf(Date);
      expect(gone?.hardDeleteAt).toBeInstanceOf(Date);
      expect(deletedMemberId).toBeGreaterThan(0);
    });

    it('carries the event date and time without shifting them', async () => {
      // A bare DATE has no timezone, so a round-trip through a JS Date moves
      // the dinner by a day either side of midnight.
      const event = await runWithTenant(tenantId, async () => prisma.events.findFirst());

      expect(event?.eventDate.toISOString().slice(0, 10)).toBe('2026-03-14');
      expect(event?.eventTime.toISOString().slice(11, 19)).toBe('19:00:00');
    });

    it('marks exactly one city default, and it is the lowest source id', async () => {
      // `resolveDefaultCityId` is the single answer to where a new member lands.
      // The lowest id is Cincinnati, matching v1's own fallback and Rob's call —
      // deliberately not the lowest name, since a rename must not move it.
      const cities = await runWithTenant(tenantId, async () =>
        prisma.cities.findMany({ orderBy: { id: 'asc' } }),
      );

      expect(cities.map((c) => c.name)).toEqual(['Cincinnati', 'Dayton']);
      expect(cities.filter((c) => c.isDefault === true)).toHaveLength(1);
      expect(cities.find((c) => c.isDefault === true)?.name).toBe('Cincinnati');
      // Never `false` — the unique index on (tenant_id, is_default) is what
      // makes "at most one default" a constraint, so the others must be NULL.
      expect(cities.find((c) => c.name === 'Dayton')?.isDefault).toBeNull();
      expect(cincinnatiId).toBeLessThan(daytonId);
    });

    it('drops the city subdomain rather than reintroducing one', async () => {
      // A city is a row, not a hostname (v2-24). The column does not exist, so
      // this asserts the import did not try to keep it somewhere else.
      const city = await runWithTenant(tenantId, async () => prisma.cities.findFirst());

      expect(city).not.toHaveProperty('subdomain');
    });

    describe('city preferences', () => {
      it('gives a member who chose city-only exactly one row', async () => {
        const dana = await runWithTenant(tenantId, async () =>
          prisma.users.findFirst({
            where: { email: 'dana@dinnerbears.test' },
            include: { userCityPreferences: { include: { city: true } } },
          }),
        );

        expect(dana?.userCityPreferences).toHaveLength(1);
        expect(dana?.userCityPreferences[0].city.name).toBe('Dayton');
      });

      it('gives everyone else no rows, which means every city', async () => {
        // The decision that departs from REQ-IMPORT-01.3 as written: v1's event
        // list is not city-filtered on www, so one row each would narrow what
        // every member sees rather than preserving it.
        const others = await runWithTenant(tenantId, async () =>
          prisma.users.findMany({
            where: { email: { not: 'dana@dinnerbears.test' } },
            include: { userCityPreferences: true },
          }),
        );

        expect(others).toHaveLength(3);
        for (const user of others) {
          expect(user.userCityPreferences, user.email).toEqual([]);
        }
      });

      it('turns feature_cities on', async () => {
        // The data is city-bearing throughout, so importing with the flag off
        // would hide a city on every row.
        const flag = await runWithTenant(tenantId, async () =>
          prisma.app_config.findFirst({ where: { configKey: 'feature_cities' } }),
        );

        expect(flag?.configValue).toBe('true');
      });
    });

    describe('calendar auto-invite', () => {
      it.each([
        ['admin@dinnerbears.test', true],
        ['dana@dinnerbears.test', true],
        ['casey@dinnerbears.test', false],
      ])('maps %s to %s', async (email, expected) => {
        // v1's none|city|all narrowed to an on/off. A member who had it off
        // must not acquire it.
        const user = await runWithTenant(tenantId, async () =>
          prisma.users.findFirst({ where: { email } }),
        );

        expect(user?.calendarAutoInvite).toBe(expected);
      });
    });

    it('closes the users <-> invites cycle', async () => {
      // No table order satisfies a cycle, so these columns are written NULL on
      // the first pass and filled in afterwards.
      const member = await runWithTenant(tenantId, async () =>
        prisma.users.findFirst({
          where: { email: 'casey@dinnerbears.test' },
          include: { users: true, invites_users_invite_idToinvites: true },
        }),
      );

      expect(member?.users?.email).toBe('admin@dinnerbears.test');
      expect(member?.invites_users_invite_idToinvites?.token).toBe('invite-token-1');
      expect(adminId).toBeGreaterThan(0);
    });

    it('carries the earned achievement through its own catalogue row', async () => {
      // The catalogue's `key` is an identifier joined on in code, so the earned
      // badge only resolves if v1's catalogue row kept it.
      const earned = await runWithTenant(tenantId, async () =>
        prisma.member_achievements.findFirst({ include: { achievement: true, member: true } }),
      );

      expect(earned?.achievement.key).toBe('first_dinner');
      expect(earned?.member.email).toBe('casey@dinnerbears.test');
      expect(earned?.achievementId).not.toBe(achievementId);
    });

    it('imports the full points ledger', async () => {
      const ledger = await runWithTenant(tenantId, async () => prisma.member_points.findMany());

      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ pointType: 'attendance', points: 10 });
    });

    it('remaps a moderation report onto the comment it reports', async () => {
      // content_id is polymorphic, remapped on content_type — the one
      // polymorphic pointer in this import that can be resolved safely, because
      // the set of types is closed.
      const report = await runWithTenant(tenantId, async () => prisma.content_reports.findFirst());
      const comment = await runWithTenant(tenantId, async () => prisma.event_comments.findFirst());

      expect(report?.contentType).toBe('event_comment');
      expect(report?.contentId).toBe(comment?.id);
      expect(report?.contentId).not.toBe(commentId);
    });

    it("imports the venue's moderator-only fields", async () => {
      // Omitted by default on the way out, which is a read concern; the import
      // still has to write them or they are lost.
      const location = await runWithTenant(tenantId, async () =>
        prisma.locations.findFirst({
          omit: { moderatorNotes: false, contactName: false },
        }),
      );

      expect(location?.moderatorNotes).toBe('Ask for the back room.');
      expect(location?.contactName).toBe('Private Contact');
      expect(locationId).toBeGreaterThan(0);
    });

    it("imports the community's branding and config", async () => {
      // Not named in REQ-IMPORT-01.3, and the import is broken without it:
      // app_config is scoped as of v2-6, so these rows are what make the
      // community look like DinnerBears rather than a blank tenant.
      const brand = await runWithTenant(tenantId, async () =>
        prisma.app_config.findFirst({ where: { configKey: 'brand_name' } }),
      );

      expect(brand?.configValue).toBe('Dinner Bears');
    });

    describe('the feedback split', () => {
      it('keeps a comment in the scoped table, with its note and upvote', async () => {
        const comments = await runWithTenant(tenantId, async () =>
          prisma.feedback.findMany({ include: { notes: true, upvotes: true } }),
        );

        expect(comments).toHaveLength(1);
        expect(comments[0]).toMatchObject({ category: 'comment', title: 'Love the app' });
        expect(comments[0].notes).toHaveLength(1);
        expect(comments[0].upvotes).toHaveLength(1);
      });

      it('routes bugs and feature requests to the global system_reports', async () => {
        const reports = await runUnscoped('reading the global report table', async () =>
          prisma.system_reports.findMany({ orderBy: { createdAt: 'asc' } }),
        );

        expect(reports.map((r) => r.category)).toEqual(['bug', 'feature_request']);
        expect(reports[0]).toMatchObject({
          title: 'RSVP button broken',
          reportedByTenantId: tenantId,
        });
      });

      it('derives a title for the report that had none', async () => {
        const reports = await runUnscoped('reading the global report table', async () =>
          prisma.system_reports.findMany({ where: { category: 'feature_request' } }),
        );

        expect(reports[0].title).toBe('Please add a dark mode toggle to the settings page.');
      });

      it('attributes a report to the remapped member, not the source id', async () => {
        const reports = await runUnscoped('reading the global report table', async () =>
          prisma.system_reports.findMany({ include: { reporter: true } }),
        );

        expect(reports[0].reporter?.email).toBe('casey@dinnerbears.test');
        expect(reports[0].reportedByUserId).not.toBe(memberId);
      });

      it('skips the notes and upvotes it cannot carry, and says so', async () => {
        // The split's cost, reported rather than discovered. The mechanism is
        // the id map: a note whose parent became a system_reports row finds no
        // mapping in the `feedback` map.
        const notes = report.tables.find((t) => t.source === 'feedback_notes');
        const upvotes = report.tables.find((t) => t.source === 'feedback_upvotes');

        expect(notes).toMatchObject({ sourceRows: 2, imported: 1 });
        expect(notes?.skipped[0].reason).toContain('which was not imported');
        expect(upvotes).toMatchObject({ sourceRows: 2, imported: 1 });
      });
    });

    describe('email credentials', () => {
      it('withholds both keys and forces overflow off by default', async () => {
        // The rehearsal runs live member data on stage, where the point is that
        // it cannot mail real members. Resend is dormant by default, so a copied
        // row arriving with overflow on makes it live with nobody enabling it.
        const config = await runWithTenant(tenantId, async () =>
          prisma.email_provider_config.findFirst(),
        );

        expect(config?.brevoApiKey).toBeNull();
        expect(config?.resendApiKey).toBeNull();
        expect(config?.resendOverflowEnabled).toBe(false);
      });

      it('still carries the allowance and the template ids', async () => {
        // Both belong to the Brevo account rather than to the community, and
        // DinnerBears keeps the same account — an inherited template id would
        // address the wrong library.
        const config = await runWithTenant(tenantId, async () =>
          prisma.email_provider_config.findFirst(),
        );

        expect(config).toMatchObject({
          brevoEnabled: true,
          brevoDailyLimit: 300,
          brevoSentToday: 7,
          tmplInvite: 12,
          tmplEventPublished: 14,
          brevoFromEmail: 'hello@dinnerbears.com',
        });
      });
    });

    it('passes its own validation', async () => {
      const result = await validate(prisma, tenantId, report);
      const errors = result.findings.filter((f) => f.severity === 'error');

      expect(errors).toEqual([]);
      expect(result.ok).toBe(true);
    });

    it('refuses a second run against the same target', async () => {
      // REQ-IMPORT-01.4: running twice against the same target must be refused,
      // not silently duplicate. The tenant row is what makes "the same target"
      // decidable.
      await expect(importOnce()).rejects.toThrow(/Refusing to import: tenant #\d+ already exists/);
    });

    it('leaves the counts unchanged after that refusal', async () => {
      const users = await runWithTenant(tenantId, async () => prisma.users.count());

      expect(users).toBe(4);
    });
  });

  describe('with --with-email-credentials', () => {
    it('carries the keys across, encrypted at rest', async () => {
      await truncateAllTables(prisma);
      const report = await importOnce({ withEmailCredentials: true });
      const tenantId = report.tenantId as number;

      const config = await runWithTenant(tenantId, async () =>
        prisma.email_provider_config.findFirst(),
      );

      // Read back through the client, so the encryption extension decrypts it.
      // Nothing in the import calls encryptSecret: the column is declared in
      // encrypted-columns.ts and the extension does it on write.
      expect(config?.brevoApiKey).toBe('xkeysib-live-secret');
      expect(config?.resendApiKey).toBe('re_live_secret');
      expect(config?.resendOverflowEnabled).toBe(true);
    }, 60_000);

    it('stores the key as ciphertext, not plaintext', async () => {
      // The randomised cipher is why an encrypted column cannot be filtered or
      // joined on, and the reason to check the raw column rather than the
      // decrypted read above.
      const rows = await prisma.$queryRawUnsafe<{ brevo_api_key: string | null }[]>(
        'SELECT brevo_api_key FROM email_provider_config WHERE brevo_api_key IS NOT NULL',
      );

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.brevo_api_key).not.toBe('xkeysib-live-secret');
      }
    });
  });

  describe('a deployment with no root tenant', () => {
    it('is refused, because the community would have no system admin', async () => {
      await truncateAllTables(prisma);
      await runUnscoped('removing the root marker for this spec', async () =>
        prisma.tenants.updateMany({ where: {}, data: { rootMarker: null, isRoot: false } }),
      );

      await expect(importOnce()).rejects.toThrow(/No root tenant exists/);

      await runUnscoped('restoring the root marker', async () =>
        prisma.tenants.updateMany({
          where: { id: TEST_TENANT_ID },
          data: { rootMarker: true, isRoot: true },
        }),
      );
    }, 60_000);
  });
});

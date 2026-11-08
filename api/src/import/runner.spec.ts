import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { toDateString, toTimeString } from '../common/utils/prisma-date.util';
import { IdMap, IdMapSequencingError } from './id-map';
import { BACKFILL_PASSES, TABLE_PLANS } from './plan';
import { copy, custom, fk, type TablePlan } from './plan-types';
import { buildRow } from './runner';

/** A context with a prepopulated map, for the row-building tests. */
function contextWith(maps: Record<string, Record<number, number>>) {
  const ids = new IdMap();
  for (const [table, pairs] of Object.entries(maps)) {
    ids.open(table);
    for (const [oldId, newId] of Object.entries(pairs)) {
      ids.record(table, Number(oldId), newId);
    }
  }
  const notes: string[] = [];
  return {
    ids,
    notes,
    ctx: {
      slug: 'dinnerbears',
      domain: 'dinnerbears.com',
      dryRun: false,
      withEmailCredentials: false,
      tenantId: 9,
      ids,
      note: (m: string) => {
        notes.push(m);
      },
      // Empty: with no column metadata, a NULL is written as NULL rather than
      // omitted, which is what these tests assert on. The NULL-to-default
      // behaviour is covered against the real schema in the e2e spec, since it
      // is a fact about the database rather than about this logic.
      target: new Map(),
    },
  };
}

describe('buildRow', () => {
  const plan: TablePlan = {
    source: 'event_rsvps',
    model: 'event_rsvps',
    columns: {
      id: custom('Source id is recorded in the id map, never written.'),
      event_id: fk('eventId', 'events', true),
      user_id: fk('userId', 'users', true),
      city_id: fk('cityId', 'cities', false),
      status: copy('status'),
    },
  };

  it('copies plain columns and rewrites every foreign key through its map', () => {
    const { ctx } = contextWith({
      events: { 4: 104 },
      users: { 7: 207 },
      cities: { 1: 301 },
    });
    const skips: string[] = [];

    const built = buildRow(
      plan,
      { id: 1, event_id: 4, user_id: 7, city_id: 1, status: 'going' },
      ctx,
      (r) => skips.push(r),
      () => undefined,
    );

    expect(built?.data).toEqual({
      eventId: 104,
      userId: 207,
      cityId: 301,
      status: 'going',
    });
    expect(skips).toEqual([]);
  });

  it('never copies a foreign key verbatim', () => {
    // REQ-IMPORT-01.2's third bullet. The target database already holds rows
    // from the root tenant, so a source id carried across points at somebody
    // else's row.
    const { ctx } = contextWith({ events: { 4: 104 }, users: { 7: 207 }, cities: {} });

    const built = buildRow(
      plan,
      { id: 1, event_id: 4, user_id: 7, city_id: null, status: 'going' },
      ctx,
      () => undefined,
      () => undefined,
    );

    expect(built?.data.eventId).not.toBe(4);
    expect(built?.data.userId).not.toBe(7);
  });

  it('writes null for a nullable key that was null in the source', () => {
    const { ctx } = contextWith({ events: { 4: 104 }, users: { 7: 207 }, cities: { 1: 301 } });
    const skips: string[] = [];

    const built = buildRow(
      plan,
      { id: 1, event_id: 4, user_id: 7, city_id: null, status: 'going' },
      ctx,
      (r) => skips.push(r),
      () => undefined,
    );

    expect(built?.data.cityId).toBeNull();
    // Not a skip: the source genuinely held NULL, which is different from an
    // orphan even though both write NULL.
    expect(skips).toEqual([]);
  });

  describe('an orphaned foreign key in the source data', () => {
    it('skips the row when the key is required, and says which key', () => {
      // An RSVP whose event was hard-deleted. Real v1 data has these; carrying
      // on is the requirement, not a concession.
      const { ctx } = contextWith({ events: {}, users: { 7: 207 }, cities: { 1: 301 } });
      const skips: string[] = [];

      const built = buildRow(
        plan,
        { id: 1, event_id: 4, user_id: 7, city_id: 1, status: 'going' },
        ctx,
        (r) => skips.push(r),
        () => undefined,
      );

      expect(built).toBeUndefined();
      expect(skips).toEqual([
        'event_rsvps.event_id points at events#4, which was not imported',
      ]);
    });

    it('nulls the column when the key is nullable, and reports it apart from skips', () => {
      // Apart, because the row is still written. Counting a blanked column as a
      // skipped row makes `imported + skipped` overshoot the source count, and
      // validation then fails a clean import.
      const { ctx } = contextWith({ events: { 4: 104 }, users: { 7: 207 }, cities: {} });
      const skips: string[] = [];
      const nulls: string[] = [];

      const built = buildRow(
        plan,
        { id: 1, event_id: 4, user_id: 7, city_id: 1, status: 'going' },
        ctx,
        (r) => skips.push(r),
        (r) => nulls.push(r),
      );

      expect(built?.data.cityId).toBeNull();
      expect(nulls[0]).toContain('written as NULL');
      expect(skips).toEqual([]);
    });

    it('skips a required key that is NULL in the source', () => {
      const { ctx } = contextWith({ events: { 4: 104 }, users: { 7: 207 }, cities: { 1: 301 } });
      const skips: string[] = [];

      const built = buildRow(
        plan,
        { id: 1, event_id: null, user_id: 7, city_id: 1, status: 'going' },
        ctx,
        (r) => skips.push(r),
        () => undefined,
      );

      expect(built).toBeUndefined();
      expect(skips[0]).toContain('is NULL but the target column is required');
    });
  });

  describe('a table the plan has not reached', () => {
    it('throws rather than skipping the row', () => {
      // The distinction that matters: a sequencing bug must not be absorbed by
      // the orphan path, which would turn it into silent data loss across a
      // whole table.
      const { ctx } = contextWith({ users: { 7: 207 }, cities: { 1: 301 } });

      expect(() =>
        buildRow(
          plan,
          { id: 1, event_id: 4, user_id: 7, city_id: 1, status: 'going' },
          ctx,
          () => undefined,
          () => undefined,
        ),
      ).toThrow(IdMapSequencingError);
    });
  });

  describe('a transform', () => {
    it('merges over the column rules by default', () => {
      const withTransform: TablePlan = {
        ...plan,
        transform: () => ({ action: 'write', data: { status: 'maybe', extra: true } }),
      };
      const { ctx } = contextWith({ events: { 4: 104 }, users: { 7: 207 }, cities: { 1: 301 } });

      const built = buildRow(
        withTransform,
        { id: 1, event_id: 4, user_id: 7, city_id: 1, status: 'going' },
        ctx,
        () => undefined,
        () => undefined,
      );

      expect(built?.data).toEqual({
        eventId: 104,
        userId: 207,
        cityId: 301,
        status: 'maybe',
        extra: true,
      });
    });

    it('can skip a row with a stated reason', () => {
      const withTransform: TablePlan = {
        ...plan,
        transform: () => ({ action: 'skip', reason: 'no place for this in v2' }),
      };
      const { ctx } = contextWith({ events: { 4: 104 }, users: { 7: 207 }, cities: { 1: 301 } });
      const skips: string[] = [];

      const built = buildRow(
        withTransform,
        { id: 1, event_id: 4, user_id: 7, city_id: 1, status: 'going' },
        ctx,
        (r) => skips.push(r),
        () => undefined,
      );

      expect(built).toBeUndefined();
      expect(skips).toEqual(['no place for this in v2']);
    });

    it('replaces the column rules entirely when it redirects to another model', () => {
      // The feedback split. The rules name fields on the default model, and
      // most of them are not fields on the one being redirected to — merging
      // would hand Prisma an unknown argument for every column the two models
      // do not share.
      const withTransform: TablePlan = {
        ...plan,
        transform: () => ({
          action: 'write',
          model: 'system_reports',
          idMapName: 'system_reports',
          data: { title: 'moved' },
        }),
      };
      const { ctx } = contextWith({ events: { 4: 104 }, users: { 7: 207 }, cities: { 1: 301 } });

      const built = buildRow(
        withTransform,
        { id: 1, event_id: 4, user_id: 7, city_id: 1, status: 'going' },
        ctx,
        () => undefined,
        () => undefined,
      );

      expect(built).toEqual({
        model: 'system_reports',
        mapName: 'system_reports',
        data: { title: 'moved' },
      });
      expect(built?.data).not.toHaveProperty('eventId');
    });

    it('defaults the map name to the model it redirects to', () => {
      const withTransform: TablePlan = {
        ...plan,
        transform: () => ({ action: 'write', model: 'system_reports', data: {} }),
      };
      const { ctx } = contextWith({ events: { 4: 104 }, users: { 7: 207 }, cities: { 1: 301 } });

      const built = buildRow(
        withTransform,
        { id: 1, event_id: 4, user_id: 7, city_id: 1, status: 'going' },
        ctx,
        () => undefined,
        () => undefined,
      );

      expect(built?.mapName).toBe('system_reports');
    });
  });

  it('refuses a plan with no model whose transform names none', () => {
    const noModel: TablePlan = { source: 'x', model: null, columns: {} };
    const { ctx } = contextWith({});

    expect(() => buildRow(noModel, { id: 1 }, ctx, () => undefined, () => undefined)).toThrow(
      /must redirect every row/,
    );
  });
});

/**
 * The plan against the generated Prisma client.
 *
 * `modelDelegate` looks a model up by string, so a renamed model is a runtime
 * failure at row one of a live import. These checks move it to the suite.
 */
describe('the plan against schema.prisma', () => {
  const MODEL_NAMES = new Set(Prisma.dmmf.datamodel.models.map((m) => m.name));

  it('names only models that exist', () => {
    for (const plan of TABLE_PLANS) {
      for (const name of plan.idMapNames ?? [plan.model]) {
        if (name === null) continue;
        expect(MODEL_NAMES.has(name), `${plan.source} writes to "${name}"`).toBe(true);
      }
    }
  });

  it('writes only fields that exist on the model it writes to', () => {
    // Catches the mapping mistake a type system cannot here: the plan's target
    // fields are strings, so a renamed Prisma field would otherwise surface as
    // "Unknown argument" partway through a live import.
    const fieldsByModel = new Map(
      Prisma.dmmf.datamodel.models.map((m) => [m.name, new Set(m.fields.map((f) => f.name))]),
    );

    for (const plan of TABLE_PLANS) {
      if (!plan.model) continue;
      const fields = fieldsByModel.get(plan.model);
      expect(fields, `${plan.model} is not a model`).toBeDefined();

      for (const [column, rule] of Object.entries(plan.columns)) {
        if (rule.kind !== 'copy' && rule.kind !== 'fk') continue;
        expect(
          fields?.has(rule.field),
          `${plan.source}.${column} writes ${plan.model}.${rule.field}, which does not exist`,
        ).toBe(true);
      }
    }
  });

  it('remaps every foreign key through a map some table actually fills', () => {
    const filled = new Set(
      TABLE_PLANS.flatMap((plan) => [...(plan.idMapNames ?? [plan.model])].filter(Boolean)),
    );

    for (const plan of TABLE_PLANS) {
      for (const [column, rule] of Object.entries(plan.columns)) {
        if (rule.kind !== 'fk') continue;
        expect(
          filled.has(rule.table),
          `${plan.source}.${column} remaps through "${rule.table}", which nothing fills`,
        ).toBe(true);
      }
    }
  });

  it('scopes every imported model except the one that is global by design', () => {
    // An import that wrote to an unscoped model would put rows outside any
    // community without the extension objecting. `facebook_deletion_requests`
    // is the single deliberate exception: the callback arrives unauthenticated
    // carrying no host a tenant could be resolved from.
    const unscoped = TABLE_PLANS.filter((plan) => {
      if (!plan.model) return false;
      const model = Prisma.dmmf.datamodel.models.find((m) => m.name === plan.model);
      return !model?.fields.some((f) => f.name === 'tenantId');
    }).map((plan) => plan.model);

    expect(unscoped).toEqual(['facebook_deletion_requests']);
  });
});

describe('the city plan', () => {
  it('writes no default marker while importing rows', () => {
    // Deliberately not a transform. Ids are merged into the map only once a
    // table's transaction commits, so a transform cannot ask "am I the first
    // row of this table" and get a true answer — asking anyway marked every
    // city default and failed the unique index. It is a backfill pass instead.
    const plan = TABLE_PLANS.find((p) => p.source === 'cities');

    expect(plan?.transform).toBeUndefined();
  });

  it('drops the subdomain with a reason rather than silently', () => {
    const plan = TABLE_PLANS.find((p) => p.source === 'cities');
    const rule = plan?.columns['subdomain'];

    expect(rule?.kind).toBe('drop');
    expect(rule && 'reason' in rule ? rule.reason : '').toMatch(/a city is a row, not a host/);
  });
});

describe('the default-city pass', () => {
  const pass = BACKFILL_PASSES.find((p) => p.name === 'cities.default-marker');

  /** A backfill context over a fixed set of source cities. */
  function passContext(sourceIds: number[], mapped: Record<number, number>) {
    const { ids, notes, ctx } = contextWith({ cities: mapped });
    const updates: { model: string; id: number; data: Record<string, unknown> }[] = [];
    return {
      notes,
      updates,
      ctx: {
        ...ctx,
        ids,
        dryRun: false,
        fetch: async () => sourceIds.map((id) => ({ id })),
        update: async (model: string, id: number, data: Record<string, unknown>) => {
          updates.push({ model, id, data });
        },
        create: async () => undefined,
        upsert: async () => undefined,
      },
    };
  }

  it('marks the lowest source id, not the lowest name', async () => {
    // resolveDefaultCityId is explicit that a rename must not move the default.
    const { ctx, updates } = passContext([2, 1], { 1: 500, 2: 501 });

    const count = await pass?.run(ctx);

    expect(count).toBe(1);
    expect(updates).toEqual([{ model: 'cities', id: 500, data: { isDefault: true } }]);
  });

  it('writes true, never false, so the unique index means what it says', async () => {
    const { ctx, updates } = passContext([1, 2], { 1: 500, 2: 501 });
    await pass?.run(ctx);

    expect(updates).toHaveLength(1);
    expect(updates[0].data.isDefault).toBe(true);
  });

  it('skips a lowest-id city that was not imported', async () => {
    // An orphan at the front of the list must not leave the community with no
    // default at all.
    const { ctx, updates } = passContext([1, 2], { 2: 501 });
    await pass?.run(ctx);

    expect(updates).toEqual([{ model: 'cities', id: 501, data: { isDefault: true } }]);
  });

  it('reports rather than throwing when no city was imported', async () => {
    const { ctx, updates, notes } = passContext([1], {});
    const count = await pass?.run(ctx);

    expect(count).toBe(0);
    expect(updates).toEqual([]);
    expect(notes[0]).toContain('none could be marked default');
  });
});

describe('the users plan', () => {
  const plan = TABLE_PLANS.find((p) => p.source === 'users');

  it('carries calendar_token verbatim', () => {
    // 26 of 62 members have a live iCal subscription whose URL contains this
    // token. Nothing surfaces an error if it changes; the feed just stops.
    expect(plan?.columns['calendar_token']).toEqual({ kind: 'copy', field: 'calendarToken' });
  });

  it('carries both soft-delete timestamps', () => {
    // Without them, v1's soft-deleted members return as active; without the
    // rows at all, their RSVPs and comments lose their FK target.
    expect(plan?.columns['deleted_at']).toEqual({ kind: 'copy', field: 'deletedAt' });
    expect(plan?.columns['hard_delete_at']).toEqual({ kind: 'copy', field: 'hardDeleteAt' });
  });

  it('maps v1 is_automation_account onto v2 is_service_account', () => {
    // Guards key on this column and never on the role, which is deliberately
    // mutable. Losing it would put v1's automation accounts in the member
    // directory and on the leaderboard.
    expect(plan?.columns['is_automation_account']).toEqual({
      kind: 'copy',
      field: 'isServiceAccount',
    });
  });

  it.each([
    ['none', false],
    ['city', true],
    ['all', true],
  ])('turns calendar_auto_invite %s into %s', (source, expected) => {
    // REQ-IMPORT-01.3: a member who had auto-invite off must not acquire it.
    const { ctx } = contextWith({});
    const outcome = plan?.transform?.({ calendar_auto_invite: source }, ctx);

    expect(outcome).toMatchObject({ data: { calendarAutoInvite: expected } });
  });
});

describe('the feedback plan', () => {
  const plan = TABLE_PLANS.find((p) => p.source === 'feedback');

  function run(row: Record<string, unknown>) {
    const { ctx, notes } = contextWith({ users: { 7: 207 } });
    return { outcome: plan?.transform?.(row, ctx), notes };
  }

  it('keeps a comment in the scoped feedback table', () => {
    const { outcome } = run({ id: 1, category: 'comment', user_id: 7, body: 'nice dinner' });

    expect(outcome?.action).toBe('write');
    expect((outcome as { model?: string }).model).toBeUndefined();
  });

  it.each(['bug', 'feature_request'])('routes a %s to the global system_reports', (category) => {
    const { outcome } = run({
      id: 1,
      category,
      user_id: 7,
      title: 'Broken',
      body: 'it broke',
      status: 'open',
    });

    expect(outcome).toMatchObject({
      model: 'system_reports',
      idMapName: 'system_reports',
      data: { category, title: 'Broken', reportedByUserId: 207, reportedByTenantId: 9 },
    });
  });

  it('says what the split leaves behind, per ticket', () => {
    // The cost is reported rather than discovered: system_reports has no notes
    // or upvotes table and four fewer columns.
    const { notes } = run({ id: 42, category: 'bug', user_id: 7, body: 'x', status: 'open' });

    expect(notes[0]).toContain('feedback#42');
    expect(notes[0]).toContain('notes, upvotes');
  });

  it('derives a title for a report that had none, rather than dropping it', () => {
    // v1's feedback.title is nullable and system_reports.title is NOT NULL.
    // Losing a member's report over a missing title would be worse than a
    // generated one.
    const { outcome } = run({
      id: 1,
      category: 'bug',
      user_id: 7,
      title: null,
      body: 'The RSVP button does nothing\nSteps: click it',
      status: 'open',
    });

    expect(outcome).toMatchObject({ data: { title: 'The RSVP button does nothing' } });
  });

  it('truncates a derived title on a word boundary', () => {
    const { outcome } = run({
      id: 1,
      category: 'bug',
      user_id: 7,
      title: null,
      body: `${'word '.repeat(60)}end`,
      status: 'open',
    });

    const title = (outcome as unknown as { data: { title: string } }).data.title;
    expect(title.length).toBeLessThanOrEqual(200);
    expect(title.endsWith('word')).toBe(true);
  });

  it('falls back to a placeholder for an empty body', () => {
    const { outcome } = run({ id: 1, category: 'bug', user_id: 7, title: null, body: '', status: 'open' });

    expect(outcome).toMatchObject({ data: { title: '(no title)' } });
  });

  it('routes notes and upvotes through the feedback map, so split tickets lose them', () => {
    // The mechanism, not a special case: a note whose parent became a
    // system_reports row finds no mapping in the `feedback` map and is skipped.
    const notes = TABLE_PLANS.find((p) => p.source === 'feedback_notes');
    const upvotes = TABLE_PLANS.find((p) => p.source === 'feedback_upvotes');

    expect(notes?.columns['feedback_id']).toEqual({
      kind: 'fk',
      field: 'feedbackId',
      table: 'feedback',
      required: true,
    });
    expect(upvotes?.columns['feedback_id']).toEqual({
      kind: 'fk',
      field: 'feedbackId',
      table: 'feedback',
      required: true,
    });
  });
});

describe('the email provider config plan', () => {
  const plan = TABLE_PLANS.find((p) => p.source === 'email_provider_config');

  it('withholds both keys and forces overflow off by default', () => {
    // Resend is dormant by default, so a copied row arriving with overflow on
    // turns a dormant provider into a live one with nobody having enabled it.
    const { ctx, notes } = contextWith({});
    const outcome = plan?.transform?.(
      { brevo_api_key: 'live-key', resend_api_key: 'live-key-2', resend_overflow_enabled: 1 },
      ctx,
    );

    expect(outcome).toMatchObject({
      data: { brevoApiKey: null, resendApiKey: null, resendOverflowEnabled: false },
    });
    expect(notes[0]).toContain('WITHOUT credentials');
  });

  it('carries them when the run explicitly asks', () => {
    const { ctx, notes } = contextWith({});
    const outcome = plan?.transform?.(
      { brevo_api_key: 'live-key', resend_api_key: 'live-key-2', resend_overflow_enabled: 1 },
      { ...ctx, withEmailCredentials: true },
    );

    expect(outcome).toMatchObject({
      data: { brevoApiKey: 'live-key', resendApiKey: 'live-key-2', resendOverflowEnabled: 1 },
    });
    expect(notes[0]).toContain('WITH credentials');
  });

  it('carries every template id, because they belong to the account', () => {
    // An inherited template id addresses the wrong library. DinnerBears keeps
    // the same Brevo account across cutover, so these must come across.
    const templateColumns = Object.keys(plan?.columns ?? {}).filter((c) => c.startsWith('tmpl_'));

    expect(templateColumns).toHaveLength(13);
    for (const column of templateColumns) {
      expect(plan?.columns[column].kind, column).toBe('copy');
    }
  });
});

describe('the content report plans', () => {
  it.each(['content_reports', 'content_flags'])('remaps %s.content_id on content_type', (source) => {
    const plan = TABLE_PLANS.find((p) => p.source === source);
    const { ctx } = contextWith({ event_comments: { 5: 605 } });

    const outcome = plan?.transform?.(
      { id: 1, content_type: 'event_comment', content_id: 5 },
      ctx,
    );

    expect(outcome).toMatchObject({ data: { contentId: 605 } });
  });

  it('leaves an unknown content_type alone and reports it', () => {
    // A closed set on purpose: guessing which table an unrecognised type points
    // at means a moderation report naming an unrelated row.
    const plan = TABLE_PLANS.find((p) => p.source === 'content_reports');
    const { ctx, notes } = contextWith({});

    const outcome = plan?.transform?.({ id: 1, content_type: 'poem', content_id: 5 }, ctx);

    expect(outcome).toMatchObject({ data: { contentId: 5 } });
    expect(notes[0]).toContain('does not know how to remap');
  });

  it('leaves content_id alone when the target row was not imported', () => {
    const plan = TABLE_PLANS.find((p) => p.source === 'content_reports');
    const { ctx, notes } = contextWith({ event_comments: {} });

    const outcome = plan?.transform?.(
      { id: 1, content_type: 'event_comment', content_id: 5 },
      ctx,
    );

    expect(outcome).toMatchObject({ data: { contentId: 5 } });
    expect(notes[0]).toContain('was not imported');
  });
});

describe('the events plan', () => {
  it('anchors the date and time to UTC so they round-trip unchanged', () => {
    // A bare DATE has no timezone. Parsing '2026-03-14' without the explicit Z
    // applies the host's offset, which moves the dinner to the previous day in
    // any negative-offset timezone — the same bug toEventDateStrings exists to
    // stop on the read side, and this machine is one of those timezones.
    const plan = TABLE_PLANS.find((p) => p.source === 'events');
    const { ctx } = contextWith({});

    const outcome = plan?.transform?.({ event_date: '2026-03-14', event_time: '19:00:00' }, ctx);
    const data = (outcome as unknown as { data: { eventDate: Date; eventTime: Date } }).data;

    expect(toDateString(data.eventDate)).toBe('2026-03-14');
    expect(toTimeString(data.eventTime)).toBe('19:00:00');
    // A TIME is stored on 1970-01-01, which is how the driver hands it back.
    expect(data.eventTime.toISOString()).toBe('1970-01-01T19:00:00.000Z');
  });
});

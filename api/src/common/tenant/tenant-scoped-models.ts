import { Prisma } from '@prisma/client';

/**
 * Which models carry a `tenant_id` and are therefore filtered by the tenant
 * scoping extension (REQ-TENANT-01.3).
 *
 * This file is the single declaration of that split. The schema, the migration
 * and the extension all follow it rather than each carrying their own idea of
 * which tables are tenant data — a model that is scoped in one place and global
 * in another is a leak that no individual file looks wrong.
 *
 * Two guards keep it honest, both deliberately at build/test time rather than
 * at runtime, because the failure they prevent is silent:
 *
 *  - `assertEveryModelClassified` below is a *type-level* check. Every member of
 *    `Prisma.ModelName` must appear in exactly one of the two lists, so adding a
 *    model to schema.prisma without classifying it does not compile.
 *  - `tenant-scoped-models.spec.ts` checks the lists against the generated DMMF,
 *    so a model listed as SCOPED that has no `tenantId` field (or a model listed
 *    as GLOBAL that has one) fails a test.
 *
 * Neither can be satisfied by guessing: the honest answer for a new model is
 * "does a row of this belong to one community, or to the deployment?"
 */

/**
 * Tenant data. Every row belongs to exactly one community, and the extension
 * refuses to read or write any of these without a tenant in context.
 */
export const TENANT_SCOPED_MODELS = [
  'achievements',
  /**
   * An integration's bearer tokens (v2-29). Scoped, and the scoping is what
   * makes the token meaningful: it is `api_tokens.tenant_id` that tells
   * `MuseTenantMiddleware` which community a call belongs to, since an
   * integration presents no cookie and we deliberately do not trust the Host
   * header for it.
   *
   * The guard's own lookup is therefore the one read that cannot be scoped --
   * it happens *before* a tenant is known, so it runs under an explicit
   * `runUnscoped` and then enters the tenant the row names.
   */
  'api_tokens',
  'announcement_comments',
  'app_config',
  'announcements',
  'audit_log',
  'content_flags',
  'content_reports',
  'custom_icons',
  'email_provider_config',
  'email_log_views',
  'email_queue',
  'event_comment_replies',
  'event_comments',
  'event_guest_links',
  'event_facebook_links',
  'event_rsvps',
  'events',
  /// The Facebook mirror's three tables (v2-29). All scoped: a Facebook event,
  /// a Facebook person and their Going status all belong to the community whose
  /// dinner they mirror. Two communities may hold rows for the SAME Facebook
  /// event or person, which is why those uniques carry the tenant.
  'facebook_accounts',
  'facebook_event_attendees',
  'facebook_group_config',
  'feedback',
  'feedback_notes',
  'feedback_upvotes',
  'invites',
  'location_photos',
  'location_ratings',
  'locations',
  'login_sessions',
  'member_achievements',
  'member_points',
  'notification_preferences',
  'notifications',
  'oauth_accounts',
  'oauth_handoffs',
  'push_subscriptions',
  'tenant_secrets',
  'users',
] as const;

/**
 * Not tenant data — the extension leaves these alone entirely.
 *
 * Two reasons are mixed together here, and they are worth keeping straight
 * because only one of them is permanent:
 *
 *  1. **Genuinely global.** `tenants` is the registry the scoping reads from,
 *     so scoping it would be circular. `releases`/`release_feedback` are the
 *     platform's own release notes, one set for the whole deployment.
 *     `email_suppressions` records that an address hard-bounced, which is a
 *     property of the address and not of whoever mailed it — re-mailing a dead
 *     address from a second tenant is exactly the behaviour that gets a sending
 *     domain blocked. `facebook_deletion_requests` arrives as an unauthenticated
 *     callback from Facebook carrying no host we could resolve a tenant from.
 *
 *  2. **Reference data written by `seed.ts`, which runs before any tenant
 *     exists.** The install order is `migrate deploy` -> `seed.js` ->
 *     `bootstrap.js`, and it is bootstrap that creates the root tenant.
 *     `cities`, `avatar` and `merch_config` are all seeded into a database
 *     with zero tenant rows, so they cannot carry a NOT NULL `tenant_id`
 *     without reordering the install.
 *
 *     `app_config` and `users` used to be in this group and are not any more:
 *     v2-6 moved the rows that genuinely belong to a community (branding and
 *     feature flags; every account) into the scoped list, and moved the two
 *     things `seed.ts` wrote that had no tenant — the `app_config` defaults and
 *     the automation account — into `bootstrap.ts`, which creates the tenant
 *     first. Anything left here in category (2) is reference data that is the
 *     same for every community, not configuration of one.
 */
export const GLOBAL_MODELS = [
  'avatar',
  'cities',
  /**
   * Both of v2-32's report tables are global, for opposite-looking reasons that
   * are the same reason: each has to outlive the community it came from.
   *
   * `system_reports` is read by every non-demo community's admins, so scoping it
   * would hide it from its whole audience. `demo_feedback` is read by nobody but
   * the demo's own admin and the operator -- but a demo is purged after seven
   * days, and a scoped row would be erased exactly when it became the only
   * record of what the visitor thought.
   *
   * Neither is a hole in the isolation: what crosses a boundary is what its
   * author wrote *in order to* send it across one.
   *
   * **This list is also where the bug/feature-request/comment split is
   * enforced** (Rob, 2026-10-04). Bugs and feature requests are about the
   * product and live in `system_reports`; general comments are about a
   * community and stay in the scoped `feedback`. That had to be a table
   * boundary rather than a column on one table, because scoping is per *model*
   * here and deliberately so -- a predicate that applied to some rows and not
   * others is the kind of isolation nobody can confirm by reading a query.
   */
  'demo_feedback',
  // Written before the tenant it will create exists -- see the model comment.
  'demo_requests',
  'email_suppressions',
  'facebook_deletion_requests',
  /**
   * The inbound mail log (v2-34) is global so that it can hold the row that
   * matters most: a message that resolved to **no** community.
   *
   * The handler runs outside any request, so the tenant is derived from the
   * event the reply's UID names -- and when nothing resolves, `tenant_id` is
   * left NULL. A scoped table cannot store that row at all, and it is both the
   * most valuable row on the screen and the shape a multi-tenant fault takes.
   *
   * The cost of being here is that the extension injects nothing, so **every
   * tenant-facing read must carry its own `tenant_id` predicate** and a
   * forgotten one shows a community somebody else's mail. The operator's read
   * carries none, deliberately. Not a hole in the isolation -- the rows are
   * reports about the deployment's own plumbing, held by whoever operates it.
   */
  'inbound_emails',
  'merch_config',
  'release_feedback',
  'releases',
  'system_reports',
  'tenants',
] as const;

export type TenantScopedModel = (typeof TENANT_SCOPED_MODELS)[number];
export type GlobalModel = (typeof GLOBAL_MODELS)[number];

/**
 * Global models that nevertheless carry a `tenantId`, and may only carry a
 * **nullable** one.
 *
 * Normally a `tenant_id` on a global model is a bug with a specific shape: a
 * model that was meant to be scoped, classified global by mistake, leaving a
 * column that looks filtered in the schema and is filtered by nothing. The spec
 * enforces that, and it is why this list exists rather than the check simply
 * being relaxed -- an exception nobody declared is indistinguishable from that
 * mistake.
 *
 * What makes `inbound_emails` legitimate is the **nullability**, which the spec
 * also enforces. A scoped model's `tenantId` is non-null precisely so a row
 * cannot belong to nobody; this table's whole purpose includes the row that
 * belongs to nobody -- a message that arrived and matched no community, which is
 * the most valuable row on its screen and the shape a multi-tenant fault takes.
 * A required column could not express it and a scoped table could not hold it.
 *
 * Adding to this list is a deliberate act with a cost: every tenant-facing read
 * of that model must carry its own predicate, because the extension will not.
 */
export const GLOBAL_MODELS_WITH_OPTIONAL_TENANT = ['inbound_emails'] as const satisfies readonly GlobalModel[];

/**
 * Compile-time proof that the two lists cover `Prisma.ModelName` exactly.
 *
 * `Unclassified` is the set of models in neither list and `Duplicated` the set
 * in both; each is assigned to `never`, so either being non-empty is a type
 * error at this line naming the offending model. A runtime check could not do
 * this job — it would only fire once a query happened to touch the new model,
 * which for an unclassified (and therefore unscoped) model is precisely the
 * request that leaks it.
 */
type Unclassified = Exclude<Prisma.ModelName, TenantScopedModel | GlobalModel>;
type Duplicated = TenantScopedModel & GlobalModel;
export type ModelClassificationIsExhaustive = [Unclassified, Duplicated] extends [never, never]
  ? true
  : ['UNCLASSIFIED MODELS:', Unclassified, 'MODELS IN BOTH LISTS:', Duplicated];
export const MODEL_CLASSIFICATION_IS_EXHAUSTIVE: ModelClassificationIsExhaustive = true;

const SCOPED_LOOKUP: ReadonlySet<string> = new Set(TENANT_SCOPED_MODELS);

/**
 * Whether the extension should scope a given model.
 *
 * Takes a plain string because that is what a Prisma extension's `model`
 * argument is at runtime, and narrows on the way out so callers cannot forget
 * to check before treating a name as scoped.
 */
export function isTenantScopedModel(model: string | undefined): model is TenantScopedModel {
  return model !== undefined && SCOPED_LOOKUP.has(model);
}

/** The column the extension filters on, and its Prisma field name. */
export const TENANT_ID_FIELD = 'tenantId';
export const TENANT_ID_COLUMN = 'tenant_id';

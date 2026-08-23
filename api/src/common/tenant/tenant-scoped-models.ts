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
  'announcement_comments',
  'app_config',
  'announcements',
  'audit_log',
  'content_flags',
  'content_reports',
  'custom_icons',
  'email_provider_config',
  'email_queue',
  'event_comment_replies',
  'event_comments',
  'event_guest_links',
  'event_rsvps',
  'events',
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
 *     `cities`, `avatar`, `achievements`, `email_provider_config` and
 *     `merch_config` are all seeded into a database with zero tenant rows, so
 *     they cannot carry a NOT NULL `tenant_id` without reordering the install.
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
  'achievements',
  'avatar',
  'cities',
  'email_suppressions',
  'facebook_deletion_requests',
  'merch_config',
  'release_feedback',
  'releases',
  'tenants',
] as const;

export type TenantScopedModel = (typeof TENANT_SCOPED_MODELS)[number];
export type GlobalModel = (typeof GLOBAL_MODELS)[number];

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

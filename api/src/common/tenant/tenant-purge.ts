/**
 * Erasing every row belonging to one community, in an order the foreign keys
 * actually permit.
 *
 * Two places do this: `TenantsAdminService.remove` deletes a community for good
 * (v2-6), and v2-14's demo reset empties the demo before re-seeding it. Both
 * walk `TENANT_SCOPED_MODELS` and both filter by `tenantId` explicitly rather
 * than leaning on the scoping extension — a `deleteMany({})` that silently lost
 * its filter would empty every community, and a transaction client is not
 * somewhere to bet on an extension being applied.
 *
 * ## Why this file exists
 *
 * The purge's own comment used to say order did not matter, "every foreign key
 * among the scoped tables is ON DELETE CASCADE". Most are. Three are not, and
 * all three point the wrong way for a straight walk of an alphabetical list:
 *
 *  - `users.invite_id -> invites` — `invites` sorts first, so deleting them
 *    leaves every member who registered through one pointing at a row that is
 *    going away. That is every member of a real community except its first
 *    admin, which makes this the common case rather than an edge one.
 *  - every `city_id -> cities` — `cities` sorts near the front of the list and
 *    five tables point at it with NO ACTION keys, four of which (`events`,
 *    `locations`, `users`, `invites`) sort after it. Added by v2-24, which
 *    scoped `cities`; before that it was global and the purge never touched it.
 *    Deliberately NOT made cascading: nothing in the product deletes a city, so
 *    the restrictive key stays a backstop against an unplanned one, and this
 *    purge — the single path that legitimately removes them — says so out loud
 *    by clearing the columns first.
 *  - `users.invited_by -> users` — self-referential, so no ordering of the list
 *    can fix it: a single `DELETE` that removes an inviter and the member they
 *    invited checks the constraint row by row, and fails depending on which the
 *    scan reaches first.
 *
 * MySQL checks NO ACTION immediately (it is a synonym for RESTRICT there, not
 * the deferred check the SQL standard describes), so each of these is an error
 * 1451 at the moment the parent row goes, not something that resolves by the end
 * of the transaction.
 *
 * The fix is to drop the references before deleting anything, which is safe
 * precisely because all three columns are nullable — they record provenance
 * ("who invited this member"), and the rows recording it are about to cease to
 * exist. Found while building the demo reset (v2-14); the delete path has never
 * been run against a community with redeemed invites, which is why it had not
 * surfaced. `tenant-scoped-models.spec.ts` now derives this list from the
 * migrations, so a future restrictive foreign key in the wrong direction fails a
 * test rather than an operator's delete.
 */
import { TENANT_SCOPED_MODELS, type TenantScopedModel } from './tenant-scoped-models';

/**
 * The narrow slice of a Prisma transaction client this needs.
 *
 * Deliberately structural rather than `Prisma.TransactionClient`: the callers
 * hold differently-extended clients (one inside a request, one in a `@Cron`
 * under a waiver, one in a standalone script), and naming the concrete type
 * would force a cast at every call site instead of at this one.
 */
export interface PurgeExecutor {
  updateMany(args: { where: { tenantId: number }; data: Record<string, null> }): Promise<unknown>;
  deleteMany(args: { where: { tenantId: number } }): Promise<{ count: number }>;
}

/**
 * Columns nulled before the walk, and why each one blocks it. Keyed by the model
 * that holds the column, which is also how the spec matches them against the
 * foreign keys it reads out of the migrations.
 */
export const PURGE_PRECLEARED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  users: ['inviteId', 'invitedBy', 'cityId'],
  invites: ['cityId'],
  events: ['cityId'],
  locations: ['cityId'],
  announcements: ['cityId'],
};

/**
 * Models deleted ahead of the alphabetical walk, because they hold a
 * **non-nullable** reference to a table that sorts before them.
 *
 * Nulling is the usual fix and is not available here: `user_city_preferences`
 * points at `cities` with a required column, and `cities` sorts first, so the
 * walk would reach `cities.deleteMany` while preference rows still named one.
 * Deleting it early is safe for the same reason nulling the others is — the
 * rows it points at are about to cease to exist — and it is one line rather
 * than a cascade, which would weaken the backstop that keeps an *unplanned*
 * city delete failing loudly.
 */
export const PURGE_PREDELETED_MODELS: readonly string[] = ['user_city_preferences'];

/**
 * Deletes every scoped row belonging to `tenantId`, leaving the `tenants` row
 * itself alone — callers decide whether the community is being destroyed or
 * emptied.
 *
 * `tx` must be a transaction client: half an erased community is worse than an
 * intact one, and the caller is expected to have opened a transaction with a
 * timeout well past Prisma's 5s default, since this may be years of history.
 */
export async function purgeTenantRows(
  tx: unknown,
  tenantId: number,
): Promise<Record<string, number>> {
  const delegates = tx as Record<TenantScopedModel, PurgeExecutor>;

  for (const [model, columns] of Object.entries(PURGE_PRECLEARED_COLUMNS)) {
    await delegates[model as TenantScopedModel].updateMany({
      where: { tenantId },
      data: Object.fromEntries(columns.map((column) => [column, null])),
    });
  }

  const deleted: Record<string, number> = {};
  const recordDelete = async (model: TenantScopedModel): Promise<void> => {
    const { count } = await delegates[model].deleteMany({ where: { tenantId } });
    if (count > 0) deleted[model] = count;
  };

  for (const model of PURGE_PREDELETED_MODELS) {
    await recordDelete(model as TenantScopedModel);
  }
  for (const model of TENANT_SCOPED_MODELS) {
    if (PURGE_PREDELETED_MODELS.includes(model)) continue;
    await recordDelete(model);
  }
  return deleted;
}

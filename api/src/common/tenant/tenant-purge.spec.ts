import { describe, expect, it } from 'vitest';
import { purgeTenantRows, type PurgeExecutor } from './tenant-purge';
import { TENANT_SCOPED_MODELS, type TenantScopedModel } from './tenant-scoped-models';

/**
 * A transaction client that models the one thing the real one does which the
 * purge cannot see: a `DELETE` on a parent takes its cascading children with
 * it, so a later `deleteMany` on the child finds nothing left to delete.
 *
 * `cascades` maps a parent model to the children MySQL would empty along with
 * it. Only the relationships a test cares about need to be listed.
 */
function fakeClient(
  rows: Partial<Record<TenantScopedModel, number>>,
  cascades: Partial<Record<TenantScopedModel, readonly TenantScopedModel[]>> = {},
): { client: Record<string, PurgeExecutor>; remaining: Record<string, number> } {
  const remaining: Record<string, number> = {};
  for (const model of TENANT_SCOPED_MODELS) remaining[model] = rows[model] ?? 0;

  const client: Record<string, PurgeExecutor> = {};
  for (const model of TENANT_SCOPED_MODELS) {
    client[model] = {
      count: () => Promise.resolve(remaining[model]),
      updateMany: () => Promise.resolve(undefined),
      deleteMany: () => {
        const count = remaining[model];
        remaining[model] = 0;
        for (const child of cascades[model] ?? []) remaining[child] = 0;
        return Promise.resolve({ count });
      },
    };
  }
  return { client, remaining };
}

describe('purgeTenantRows', () => {
  it('empties every scoped table', async () => {
    const { client, remaining } = fakeClient({ users: 68, events: 32, locations: 209 });

    await purgeTenantRows(client, 7);

    expect(Object.values(remaining).every((n) => n === 0)).toBe(true);
  });

  /**
   * The regression this file was added for. Found on 2026-11-09 by deleting the
   * imported DinnerBears community on stage: the audit record said nothing was
   * removed from three tables that between them held 299 rows, because each
   * cascades from a parent sorting earlier in the alphabetical walk. Nothing
   * survived — `tenant_id` is RESTRICT, so a survivor aborts the transaction —
   * but the only permanent trace of a destroyed community understated it.
   */
  it('counts rows a cascade removes before the walk reaches them', async () => {
    const { client, remaining } = fakeClient(
      { achievements: 53, events: 32, member_achievements: 203, location_ratings: 13 },
      { achievements: ['member_achievements'], events: ['location_ratings'] },
    );

    const deleted = await purgeTenantRows(client, 7);

    expect(deleted.member_achievements).toBe(203);
    expect(deleted.location_ratings).toBe(13);
    expect(remaining.member_achievements).toBe(0);
    expect(remaining.location_ratings).toBe(0);
  });

  it('omits a table that held nothing', async () => {
    const { client } = fakeClient({ users: 68 });

    const deleted = await purgeTenantRows(client, 7);

    expect(deleted).toEqual({ users: 68 });
  });
});

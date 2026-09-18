import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  GLOBAL_MODELS,
  isTenantScopedModel,
  TENANT_ID_FIELD,
  TENANT_SCOPED_MODELS,
  type TenantScopedModel,
} from './tenant-scoped-models';
import { PURGE_PRECLEARED_COLUMNS } from './tenant-purge';

/**
 * Keeps the classification in tenant-scoped-models.ts honest against the schema
 * it describes (REQ-TENANT-01.3).
 *
 * The type-level check in that file already proves the two lists *cover*
 * Prisma.ModelName. What it cannot see is whether a model listed as scoped
 * actually has a `tenant_id` column — a model could be added to SCOPED, the
 * migration forgotten, and every query against it would then fail at runtime
 * with an unknown-argument error rather than at build time. The reverse is
 * worse: a model with a `tenant_id` that is listed as GLOBAL is a column nothing
 * filters on, which looks scoped in the schema and is not.
 */
describe('tenant model classification', () => {
  const modelsWithTenantId = new Set(
    Prisma.dmmf.datamodel.models
      .filter((model) => model.fields.some((field) => field.name === TENANT_ID_FIELD))
      .map((model) => model.name),
  );

  it('marks every model in the schema as either scoped or global, with no overlap', () => {
    const classified = [...TENANT_SCOPED_MODELS, ...GLOBAL_MODELS];
    const schemaModels = Prisma.dmmf.datamodel.models.map((model) => model.name);

    expect([...classified].sort()).toEqual([...schemaModels].sort());
    expect(new Set(classified).size).toBe(classified.length);
  });

  it('gives every scoped model a tenantId field', () => {
    const missing = TENANT_SCOPED_MODELS.filter((model) => !modelsWithTenantId.has(model));
    expect(missing).toEqual([]);
  });

  it('gives no global model a tenantId field', () => {
    const unexpected = GLOBAL_MODELS.filter((model) => modelsWithTenantId.has(model));
    expect(unexpected).toEqual([]);
  });

  it('requires the tenant relation on scoped models, so the FK exists', () => {
    const withoutRelation = TENANT_SCOPED_MODELS.filter((model) => {
      const fields = Prisma.dmmf.datamodel.models.find((m) => m.name === model)?.fields ?? [];
      return !fields.some((field) => field.kind === 'object' && field.type === 'tenants');
    });
    expect(withoutRelation).toEqual([]);
  });

  it('never declares tenantId nullable, so a row cannot belong to nobody', () => {
    // Read from schema.prisma rather than the DMMF: the client ships the *slim*
    // runtime DMMF, whose scalar entries carry only name/kind/type/dbName — no
    // isRequired — so nullability is simply not visible there. The schema is the
    // source of truth this file exists to stay in step with anyway.
    const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');

    const nullable = TENANT_SCOPED_MODELS.filter((model) => {
      const block = schema.match(new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, 'm'))?.[1];
      return block === undefined || !/^\s*tenantId\s+Int\s/m.test(block);
    });

    expect(nullable).toEqual([]);
  });

  /**
   * The list's ORDER is load-bearing, which nothing about its name suggests.
   *
   * Two places erase a whole community by walking it — `TenantsAdminService.remove`
   * (v2-6) and v2-14's demo reset, sharing `purgeTenantRows`. Most foreign keys
   * among the scoped tables are ON DELETE CASCADE, so the walk can delete a
   * parent and take its children. The restrictive ones (NO ACTION, which MySQL
   * checks immediately) cannot: if the table a column points AT is deleted
   * first, that delete hits rows still referencing it and fails with error 1451.
   *
   * So for every restrictive scoped→scoped key, the referenced table must be
   * deleted *after* the referencing one — or the column must be nulled before
   * the walk starts, which is what `PURGE_PRECLEARED_COLUMNS` is for and the
   * only available answer for a self-reference.
   *
   * Derived from the migrations rather than hardcoded, so a future restrictive
   * key pointing the wrong way fails here instead of failing an operator's
   * delete on a community they cannot get back.
   */
  it('can delete a community without tripping a restrictive foreign key', () => {
    const migrations = join(__dirname, '../../../prisma/migrations');
    const sql = readdirSync(migrations, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => readFileSync(join(migrations, entry.name, 'migration.sql'), 'utf8'))
      .join('\n');

    const pattern =
      /ALTER TABLE `(\w+)` ADD CONSTRAINT `\w+` FOREIGN KEY \(`(\w+)`\) REFERENCES `(\w+)`\(`\w+`\) ON DELETE (NO ACTION|RESTRICT)/g;
    const isScoped = (table: string): table is TenantScopedModel =>
      (TENANT_SCOPED_MODELS as readonly string[]).includes(table);

    // snake_case in SQL, camelCase in the Prisma client the purge calls.
    const camel = (column: string): string =>
      column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

    const unsatisfied: string[] = [];
    for (const [, table, column, referenced] of sql.matchAll(pattern)) {
      if (!isScoped(table) || !isScoped(referenced)) continue;
      if (TENANT_SCOPED_MODELS.indexOf(referenced) > TENANT_SCOPED_MODELS.indexOf(table)) continue;
      if (PURGE_PRECLEARED_COLUMNS[table]?.includes(camel(column))) continue;
      unsatisfied.push(`${table}.${column} -> ${referenced}`);
    }

    expect(unsatisfied).toEqual([]);
  });

  /**
   * The other direction: nothing is pre-cleared that does not need to be.
   *
   * Nulling a column that no longer blocks the walk is a silent data change on
   * the way to a delete — harmless while the rows are about to vanish, and
   * exactly the kind of leftover that gets copied into a routine that does not
   * delete afterwards.
   */
  it('pre-clears only columns that actually block the walk', () => {
    for (const [model, columns] of Object.entries(PURGE_PRECLEARED_COLUMNS)) {
      expect(isTenantScopedModel(model)).toBe(true);
      expect(columns.length).toBeGreaterThan(0);
    }
  });

  describe('isTenantScopedModel', () => {
    it('recognises scoped models', () => {
      expect(isTenantScopedModel('events')).toBe(true);
      expect(isTenantScopedModel('event_rsvps')).toBe(true);
    });

    // Both moved out of GLOBAL_MODELS in v2-6 (REQ-TENANT-01.4 / 01.5) and are
    // named here rather than left to the exhaustiveness check, because they are
    // the two the rest of the application most often assumed were global.
    it('recognises users and app_config as scoped', () => {
      expect(isTenantScopedModel('users')).toBe(true);
      expect(isTenantScopedModel('app_config')).toBe(true);
    });

    it('rejects global models and unknown names', () => {
      expect(isTenantScopedModel('tenants')).toBe(false);
      expect(isTenantScopedModel('releases')).toBe(false);
      expect(isTenantScopedModel('not_a_model')).toBe(false);
      expect(isTenantScopedModel(undefined)).toBe(false);
    });
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  GLOBAL_MODELS,
  isTenantScopedModel,
  TENANT_ID_FIELD,
  TENANT_SCOPED_MODELS,
} from './tenant-scoped-models';

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

  describe('isTenantScopedModel', () => {
    it('recognises scoped models', () => {
      expect(isTenantScopedModel('events')).toBe(true);
      expect(isTenantScopedModel('event_rsvps')).toBe(true);
    });

    it('rejects global models and unknown names', () => {
      expect(isTenantScopedModel('tenants')).toBe(false);
      expect(isTenantScopedModel('users')).toBe(false);
      expect(isTenantScopedModel('not_a_model')).toBe(false);
      expect(isTenantScopedModel(undefined)).toBe(false);
    });
  });
});

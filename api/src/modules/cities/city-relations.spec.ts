import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  CITY_REFERENCES,
  CITY_REFERENCING_MODELS,
  CITY_RETIREMENT_MODELS,
} from './city-relations';

/**
 * The module throws at import time when the policy map and the schema have
 * drifted, which means it fails at **boot** — the right place, because a
 * deactivation is rare enough that an operator could discover the gap by
 * running one and leaving rows behind.
 *
 * These assertions exist anyway, for the thing a boot failure cannot give:
 * a named test that says what drifted, in CI, before the image is built.
 */
describe('city-relations', () => {
  it('derives the referencing models from the schema rather than a written list', () => {
    const fromSchema = Prisma.dmmf.datamodel.models
      .filter((m) => m.fields.some((f) => f.name === 'cityId'))
      .map((m) => m.name)
      .sort();
    expect(CITY_REFERENCING_MODELS).toEqual(fromSchema);
    expect(fromSchema.length).toBeGreaterThan(0);
  });

  it('classifies every model with a city_id, and nothing else', () => {
    expect(Object.keys(CITY_REFERENCES).sort()).toEqual([...CITY_REFERENCING_MODELS].sort());
  });

  it('gives every move-future policy a date column that exists', () => {
    for (const [model, ref] of Object.entries(CITY_REFERENCES)) {
      if (ref.policy !== 'move-future') {
        expect(ref.dateField, `${model} names a dateField its policy never reads`).toBeUndefined();
        continue;
      }
      expect(ref.dateField, `${model} is move-future and names no dateField`).toBeDefined();
      const fields = Prisma.dmmf.datamodel.models.find((m) => m.name === model)?.fields ?? [];
      expect(
        fields.some((f) => f.name === ref.dateField),
        `${model}.${ref.dateField} does not exist`,
      ).toBe(true);
    }
  });

  /**
   * The rule the whole item turns on: a past event keeps the city it was
   * actually held in. If `events` ever became `move-all`, retiring a city
   * would quietly rewrite history, and nothing else in the suite would say so.
   */
  it('keeps events on move-future, so the past is never rewritten', () => {
    expect(CITY_REFERENCES['events'].policy).toBe('move-future');
  });

  it('leaves the keep-policy models out of a retirement', () => {
    for (const model of CITY_RETIREMENT_MODELS) {
      expect(CITY_REFERENCES[model].policy).not.toBe('keep');
    }
    const kept = Object.entries(CITY_REFERENCES)
      .filter(([, ref]) => ref.policy === 'keep')
      .map(([model]) => model);
    for (const model of kept) {
      expect(CITY_RETIREMENT_MODELS).not.toContain(model);
    }
  });
});

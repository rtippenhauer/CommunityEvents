import { Prisma } from '@prisma/client';

/**
 * model name -> (relation field name -> where it leads), from the generated DMMF.
 *
 * Both Client Extensions have to walk the object graph: tenant scoping to push
 * a filter down into nested writes and includes, encryption to find the
 * declared columns wherever a query nests or returns them. Both need the same
 * answer to "what model is on the other end of `events.rsvps`", and a
 * hand-written copy of that in either would drift the first time somebody adds
 * a relation to the schema.
 *
 * Built from the datamodel once at module load; the DMMF is static.
 */

export interface RelationInfo {
  /** The model on the other end. */
  readonly target: string;
  /** True for a to-many relation. Only these accept a `where` in an include. */
  readonly isList: boolean;
}

const RELATION_TARGETS: ReadonlyMap<string, ReadonlyMap<string, RelationInfo>> = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [
    model.name,
    new Map(
      model.fields
        .filter((field) => field.kind === 'object')
        .map((field) => [field.name, { target: field.type, isList: field.isList }]),
    ),
  ]),
);

const EMPTY: ReadonlyMap<string, RelationInfo> = new Map();

/** The relations of a model, or an empty map for an unknown name. */
export function relationsOf(model: string): ReadonlyMap<string, RelationInfo> {
  return RELATION_TARGETS.get(model) ?? EMPTY;
}

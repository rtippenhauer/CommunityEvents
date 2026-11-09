import { Prisma, PrismaClient } from '@prisma/client';
import { coerceRawRows } from '../common/utils/prisma-raw.util';

/**
 * Which target columns are NOT NULL with a default, read from the target
 * database itself.
 *
 * **Why this is a query and not a lookup on the DMMF.** Prisma 7's runtime DMMF
 * carries only `name`, `kind`, `type` and `dbName` per field — `isRequired` and
 * `hasDefaultValue` are gone, so the client cannot answer "may this column hold
 * NULL". Parsing `schema.prisma` would be a second source of truth that drifts;
 * `information_schema` is the schema the import is actually writing into.
 *
 * **What it is for.** A source row may hold NULL where v2 declares the column
 * NOT NULL with a default. Writing that NULL does not fail cleanly: Prisma
 * rejects `null` for a required field by falling back to the *checked* create
 * input, and the error then names some unrelated foreign-key scalar as an
 * unknown argument — `Unknown argument 'cityId'. Did you mean 'city'?` on a row
 * whose actual problem was `hasMembership: null`, three fields further up. The
 * column has a default; leaving it out is what the default is for.
 *
 * v1's columns are NOT NULL wherever v2's are, so on the real database this
 * changes nothing. It is what stops a schema difference between the two
 * becoming a failure that points at the wrong column.
 */

export interface TargetColumn {
  readonly nullable: boolean;
  readonly hasDefault: boolean;
}

/** Model name -> Prisma field name -> what the column permits. */
export type TargetSchema = Map<string, Map<string, TargetColumn>>;

interface ColumnRow {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  IS_NULLABLE: string;
  COLUMN_DEFAULT: string | null;
  EXTRA: string;
}

export async function loadTargetSchema(prisma: PrismaClient): Promise<TargetSchema> {
  // Raw SQL, and one of the few places in this codebase that needs no
  // `requireTenantId` predicate: `information_schema` describes the database's
  // shape, not any community's rows. There is nothing here to scope.
  const rows = coerceRawRows(
    await prisma.$queryRaw<ColumnRow[]>`
      SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
        FROM information_schema.columns
       WHERE TABLE_SCHEMA = DATABASE()
    `,
  );

  const byTable = new Map<string, Map<string, TargetColumn>>();
  for (const row of rows) {
    let columns = byTable.get(row.TABLE_NAME);
    if (!columns) {
      columns = new Map();
      byTable.set(row.TABLE_NAME, columns);
    }
    columns.set(row.COLUMN_NAME, {
      nullable: row.IS_NULLABLE === 'YES',
      // AUTO_INCREMENT counts as a default: the database supplies the value, so
      // omitting the column is correct rather than merely tolerated.
      hasDefault: row.COLUMN_DEFAULT !== null || row.EXTRA.includes('auto_increment'),
    });
  }

  // Translate from table/column to the model/field names the plan is written
  // in. `dbName` is present on both models and fields in Prisma 7's DMMF and is
  // absent when the two names are identical, which is why both fall back.
  const schema: TargetSchema = new Map();
  for (const model of Prisma.dmmf.datamodel.models) {
    const columns = byTable.get(model.dbName ?? model.name);
    if (!columns) continue;

    const fields = new Map<string, TargetColumn>();
    for (const field of model.fields) {
      if (field.kind === 'object') continue;
      const column = columns.get(field.dbName ?? field.name);
      if (column) fields.set(field.name, column);
    }
    schema.set(model.name, fields);
  }

  return schema;
}

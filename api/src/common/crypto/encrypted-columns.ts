import { Prisma } from '@prisma/client';

/**
 * Which columns hold ciphertext (v2-7) — the single declaration the encryption
 * extension reads, and the only place a new encrypted column is added.
 *
 * Declared once rather than per-service for the same reason tenant scoping is
 * (see tenant-scoped-models.ts): the failure mode of forgetting is silent. A
 * service that forgets to encrypt writes a working credential in plaintext, and
 * nothing about the application misbehaves afterwards — the value only shows up
 * later, in a backup nobody was treating as sensitive.
 *
 * ## What belongs here
 *
 * A column belongs here when it holds a **credential we must be able to read
 * back** — an API key we present to Brevo, an OAuth client secret we exchange
 * with Google. Reversible encryption is the right tool precisely because the
 * plaintext is needed again.
 *
 * A column does **not** belong here when nothing needs the original value.
 * `users.password_hash` is bcrypt and must stay that way; encrypting a hash
 * would let anyone holding the key recover... a hash. Verification and reset
 * tokens are single-use random strings compared against what a link carries, so
 * they gain nothing either. `encrypted-columns.spec.ts` enforces the boundary
 * from the other side: it walks the schema for columns whose names suggest a
 * secret and fails unless each is registered here or waived there with a
 * reason, so a future `stripe_api_key` column cannot be added quietly.
 *
 * ## What it costs
 *
 * The cipher is randomised, so these columns cannot be filtered, ordered,
 * grouped or joined on — two encryptions of one value differ. That is a
 * property of the encryption and not of this list, and it is why the list is
 * confined to credentials: nothing looks a credential up by value.
 */

/** The scalar fields of one model, as the generated client describes them. */
type ScalarsOf<M extends Prisma.ModelName> = Prisma.TypeMap['model'][M]['payload']['scalars'];

/**
 * Only the string-typed scalars of a model.
 *
 * Restricting the map's values to these is what makes a typo a compile error
 * rather than a column that silently never gets encrypted — and it also rules
 * out registering, say, an Int column, which would encrypt to a string the
 * database would then refuse.
 */
type StringFieldOf<M extends Prisma.ModelName> = {
  [K in keyof ScalarsOf<M>]: ScalarsOf<M>[K] extends string | null ? K : never;
}[keyof ScalarsOf<M>] &
  string;

export type EncryptedColumnMap = {
  readonly [M in Prisma.ModelName]?: readonly StringFieldOf<M>[];
};

export const ENCRYPTED_COLUMNS = {
  // Populated today, on every install that sends mail. This is the pair v2-7
  // exists to protect: an operator's Brevo key sat in plaintext in a global
  // table, and the admin email-settings screen writes it there over HTTP.
  email_provider_config: ['brevoApiKey', 'resendApiKey', 'webhookSecret', 'webhookSecretPrevious'],

  // Every per-community credential, one row per setting. The whole column is
  // encrypted rather than some rows of it, which is the advantage of a table
  // that holds nothing else.
  tenant_secrets: ['secretValue'],

  // Reserved by v2-3 and still unwritten — v2-8 populates them. Registered
  // ahead of the writer on purpose: schema.prisma has said since v2-3 that
  // these must be encrypted before anything writes them, and the way to make
  // that true is for the guarantee to be in place first, so v2-8 gets it by
  // adding a column value rather than by remembering a rule.
  tenants: ['googleClientSecret', 'facebookAppSecret'],
} as const satisfies EncryptedColumnMap;

export type EncryptedModel = keyof typeof ENCRYPTED_COLUMNS;

const LOOKUP: ReadonlyMap<string, readonly string[]> = new Map(
  Object.entries(ENCRYPTED_COLUMNS as Record<string, readonly string[]>),
);

/**
 * The encrypted fields of a model, or undefined if it has none.
 *
 * Takes a plain string because that is what a Prisma extension's `model`
 * argument is at runtime.
 */
export function encryptedFieldsOf(model: string | undefined): readonly string[] | undefined {
  return model === undefined ? undefined : LOOKUP.get(model);
}

/** Whether any column of this model is encrypted — the extension's fast path. */
export function hasEncryptedColumns(model: string | undefined): boolean {
  return encryptedFieldsOf(model) !== undefined;
}

/** Every (model, field) pair, for the rewrap script and the spec. */
export function allEncryptedColumns(): ReadonlyArray<{ model: string; field: string }> {
  return Object.entries(ENCRYPTED_COLUMNS as Record<string, readonly string[]>).flatMap(
    ([model, fields]) => fields.map((field) => ({ model, field })),
  );
}

# Secrets at rest

*Added by `v2-7`. Applies from `v2-7` onward; a database created before it holds
plaintext until `secrets:rewrap` runs — see [Upgrading](#upgrading-an-existing-database).*

Every credential CommunityEvents stores in its database is encrypted. This
describes where the key comes from, what happens when it has to change, and what
an operator has to do in each case.

## The short version

| | |
| --- | --- |
| Algorithm | AES-256-GCM, random 96-bit IV per value, column name as AAD |
| Key source | `SECRET_ENCRYPTION_KEY` (env), else the key file, else generated on a fresh deployment |
| Rotation | add new key, keep old in `SECRET_ENCRYPTION_KEYS_RETIRED`, run `npm run secrets:rewrap` |
| Enforcement | a Prisma Client Extension, not individual services |
| What is covered | the columns listed in `api/src/common/crypto/encrypted-columns.ts` |

**A fresh install needs no key.** On first start, a deployment with no key and
no stored secrets generates one and writes it to
`SECRET_ENCRYPTION_KEY_FILE` (default `/app/appdata/secret-encryption.key`). It
logs a warning telling you to back it up. To supply one yourself instead:

```
openssl rand -base64 32
```

**That directory must be mapped to persistent storage.** If it is not, the key
lives in the container's own writable layer and is gone the next time the
container is recreated — and so is anything encrypted under it. Startup checks
for this and logs an error if the path does not look like a mounted volume, but
check the mapping rather than relying on the check: it is a heuristic
(comparing the directory's filesystem against its parent's) and it deliberately
stays quiet when it cannot tell.

This is not theoretical. It is what happened on the v2-7 stage deploy, where
`/app/appdata` had no host mapping and three consecutive container recreations
produced three different keys. Nothing was lost, because generating requires a
database with nothing encrypted in it — but the log had cheerfully said "BACK
IT UP" each time.

**Keep a copy somewhere other than the key file and the `.env` beside it.** The
key is not in the database and cannot be recovered from a backup of it — that
is the point, and it is also the cost.

## Which key this deployment is allowed to use

The database does not hold the key. It does, however, constrain which key is
valid: every stored value names the key id that wrote it, so the data can say
whether the key you have is the right one without ever containing it. At
startup that produces three outcomes.

| State | What happens |
| --- | --- |
| No key, no stored secrets | Generates one, writes the key file, warns you to back it up |
| No key, secrets present | **Refuses to start**, naming the key id(s) the data needs |
| Key present, cannot read stored data | **Refuses to start**, naming the missing key id(s) |
| Key present, some data under a retired key | Starts, warns the rotation is unfinished |

Refusing is the whole value of the check. Generating a fresh key over a
populated database would produce a deployment that starts perfectly and cannot
read a single one of its own credentials — discovered when a password-reset
email fails to send, not at boot.

Legacy plaintext counts as "nothing to lose": it names no key, so a pre-`v2-7`
database still generates one cleanly and the rewrap brings it under it.

## If the key really is lost

There is no way to decrypt the stored values. The supported recovery is to
discard them and start over:

```
CONFIRM_SECRET_RESET=discard-all-stored-secrets node dist/reset-secrets.js
```

It sets every encrypted column to NULL, which returns each setting to "not
configured". Then remove the unreadable key (unset `SECRET_ENCRYPTION_KEY`,
delete the key file), restart so a fresh key is generated, and re-enter each
credential: Admin → Email for the provider keys, Admin → API Keys per community.

The confirmation is a phrase rather than `true` for the same reason deleting a
community makes you retype its domain — a flag you can set by accident is not a
confirmation. And check first that the key is genuinely gone: if it is not,
`secrets:rewrap` moves everything onto a new key without losing anything.

## What is encrypted

The list lives in `api/src/common/crypto/encrypted-columns.ts` and is the only
place a new encrypted column is added:

- `email_provider_config.brevo_api_key`, `.resend_api_key` — the deployment's
  email provider keys, set from Admin → Email.
- `tenant_secrets.secret_value` — each community's own third-party keys, set
  from Admin → API Keys.
- `tenants.google_client_secret`, `.facebook_app_secret` — reserved since
  `v2-3`, populated by `v2-8`. Registered ahead of the writer so that the
  guarantee is already true when something first writes them.

A column is a candidate when we have to **read the credential back** — an API
key we present to Brevo, an OAuth secret we exchange with Google. Password
hashes and single-use tokens are not: nothing needs their original value, so
one-way storage is both sufficient and stronger.

`encrypted-columns.spec.ts` enforces the boundary from the other side. It walks
the Prisma schema for string columns whose names suggest a credential and fails
unless each is either encrypted or waived in that spec with a reason — so a
future `stripe_api_key` column cannot be added without someone deciding.

## How it works

Encryption is applied by a **Prisma Client Extension**
(`api/src/database/prisma/secret-encryption.extension.ts`), applied alongside
tenant scoping in `PrismaModule`. Services read and write plaintext and never
call the cipher; the extension encrypts on the way in and decrypts on the way
out, including nested writes and relations reached through `include`/`select`.

A stored value looks like this:

```
enc:v1:9f3a1c22:<base64 of iv(12) || tag(16) || ciphertext>
```

The key id is a public, non-reversible name for the key that wrote the value.
It is what makes rotation a background task rather than an outage: a value can
say which key it needs, so "written under the old key" is distinguishable from
"corrupt", and the rewrap script can find exactly the rows still to do.

Two consequences worth knowing before writing a query:

- **An encrypted column cannot be filtered, ordered, grouped or joined on.** The
  cipher is randomised, so two encryptions of one value differ. The extension
  throws rather than letting such a query return an empty result that reads as
  "no such key".
- **Raw SQL is not covered.** Prisma does not route `$queryRaw`/`$executeRaw`
  through extensions — the same hole tenant scoping has. Raw SQL touching an
  encrypted column must call `encryptSecret`/`decryptSecret` itself. Nothing in
  the codebase does today.

The column name is authenticated as GCM additional data, which binds a
ciphertext to the column it was written for. Someone with write access to the
database cannot copy one community's Google secret into another's Facebook
secret column and have it decrypt — it fails instead of producing a working
credential in the wrong place.

## Per-community keys

Three credentials resolve per community, with the env var surviving as the
deployment-wide default:

| Setting | Deployment default |
| --- | --- |
| `geocoding_api_key` | `GEOCODING_API_KEY` |
| `places_api_key` | `GOOGLE_PLACES_API_KEY` |
| `anthropic_api_key` | `ANTHROPIC_API_KEY` |

Resolution is most-specific-first — the community's own row, then the env var,
then nothing — so an install that sets nothing behaves exactly as it did before
these existed. Each of these is metered against whoever owns the key, which is
the case for letting a community supply its own rather than spending the
operator's quota.

They are set at **Admin → API Keys**, or over the API at
`PUT /api/v1/admin/secrets/:key`. No endpoint returns a stored value: the
listing reports only whether a key is set and where it resolves from. An admin
who can set a key does not need to read it, and a credential in a response is a
credential in an access log and a browser cache.

The remaining credentials stay in env, each for a reason recorded in
`api/src/common/config/env-classification.ts` — mostly that they belong to one
deployment (the push keypair, the Cloudflare worker secret) or that their real
home is a column a later item populates (the OAuth pairs, in `v2-8`).

## Rotation

Nothing is re-entered by hand, and there is no window during which the
deployment is down.

1. Move the current `SECRET_ENCRYPTION_KEY` value into
   `SECRET_ENCRYPTION_KEYS_RETIRED` (comma-separated; keep anything already
   there).
2. Put the new key in `SECRET_ENCRYPTION_KEY`.
3. Restart. **Everything already works at this point** — existing values still
   decrypt, because each names the key that wrote it. New writes use the new
   key.
4. Run the rewrap, which rewrites every stored value under the new key:

   ```
   # in the container
   node dist/rewrap-secrets.js

   # locally
   cd api && npm run secrets:rewrap
   ```

5. Re-run it. When it reports nothing left to do, remove the old key from
   `SECRET_ENCRYPTION_KEYS_RETIRED`.

Steps 3 and 4 are deliberately separable: if the rewrap fails, the site is still
serving, and the retired key is still in place.

## Upgrading an existing database

A database that predates `v2-7` holds plaintext in the encrypted columns.
Deploying this code does not break it — reads recognise a value with no `enc:`
prefix as a legacy plaintext and return it unchanged, logging a warning naming
the column once per process.

That tolerance exists so the upgrade is not an outage, not as a resting state.
Run the rewrap once after deploying:

```
node dist/rewrap-secrets.js
```

It encrypts anything still bare and reports what it did. The same command
handles both jobs, because they are the same job: bring every stored value under
the current primary key.

## Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| API exits saying the database holds secrets under key `<id>` and no key is available | The key file was lost, or its volume is not mounted | Restore it, or set `SECRET_ENCRYPTION_KEY`; if truly gone, `secrets:reset` |
| API exits saying the key does not hold `<id>` | Wrong key, or a rotation where the old key was dropped too early | Add the old key to `SECRET_ENCRYPTION_KEYS_RETIRED` and rewrap |
| Warning at startup that a rotation is unfinished | Restarted on the new key, rewrap not yet run | Run the rewrap |
| `... is not a valid encryption key: expected 32 bytes` | Malformed key (hex instead of base64 is the usual cause) | `openssl rand -base64 32` — base64, not hex |
| A new key is generated on every restart | The key file's directory is not mapped to persistent storage | Map it; startup logs an error naming the path when it can detect this |
| `... does not look like it is on a mounted volume` | Same, detected at generation time | Add the volume mapping before storing any credential |
| `... is encrypted under key <id>, which this deployment does not hold` | A key was rotated out before the rewrap finished | Put the old key back in `SECRET_ENCRYPTION_KEYS_RETIRED`, then rewrap |
| `Failed to authenticate <column>` | The stored value was altered, or copied from another column | Re-enter that one credential; nothing else is affected |
| Warning that a column "still holds an unencrypted value" | Upgraded database, rewrap not yet run | Run the rewrap |
| `Cannot filter by <column>: it is encrypted at rest` | A query filters on an encrypted column | Look the row up by another column and compare after decryption |

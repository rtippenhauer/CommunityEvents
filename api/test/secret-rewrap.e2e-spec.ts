import { INestApplication } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { TenantResolutionService } from '../src/common/tenant/tenant-resolution.service';
import { encryptSecret, secretKeyIdOf } from '../src/common/crypto/secret-cipher';
import {
  PRIMARY_KEY_ENV,
  RETIRED_KEYS_ENV,
  resetSecretKeyRing,
  secretKeyRing,
} from '../src/common/crypto/secret-key-ring';
import {
  rewrapSecrets,
  type ColumnResult,
  type RewrapClient,
} from '../src/rewrap-secrets';
import { createTestApp, truncateAllTables } from './utils/test-app';

/**
 * The rotation and migration path, run for real (v2-7).
 *
 * The Definition of Done asks for "a stated answer for key rotation that does
 * not require re-entering every secret by hand". This is that answer executed
 * rather than described — because a recovery procedure nobody has run is not a
 * procedure, and the moment it is needed is the worst moment to find out.
 *
 * Everything here uses a **bare** PrismaClient, built in this file. That is not
 * incidental: the script must not run through the encryption extension, or it
 * would decrypt on read and encrypt on write and report success having achieved
 * nothing. Reading the raw column afterwards is how each assertion checks what
 * is physically stored.
 */
describe('Secret rewrap (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let bare: PrismaClient;

  const KEY_OLD = process.env[PRIMARY_KEY_ENV] as string;
  const KEY_NEW = Buffer.from('communityevents-rotated-key-32by').toString('base64');

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    bare = new PrismaClient({
      adapter: new PrismaMariaDb({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT ?? 3306),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        timezone: 'Z',
      }),
    });
  });

  afterAll(async () => {
    await bare.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    app.get(TenantResolutionService).clearCache();

    await prisma.email_provider_config.create({
      data: { id: 1, lastResetDate: new Date('2026-08-19') },
    });
  });

  afterEach(() => {
    // The key ring is module state shared with the running app, so a test that
    // rotates has to put it back or every later spec reads under the wrong key.
    resetSecretKeyRing();
    process.env[PRIMARY_KEY_ENV] = KEY_OLD;
    delete process.env[RETIRED_KEYS_ENV];
  });

  async function storedKey(): Promise<string | null> {
    const [row] = await prisma.$queryRaw<{ brevo_api_key: string | null }[]>`
      SELECT brevo_api_key FROM email_provider_config WHERE id = 1`;
    return row?.brevo_api_key ?? null;
  }

  const run = (): Promise<ColumnResult[]> => rewrapSecrets(bare as unknown as RewrapClient);

  it('encrypts a plaintext value left over from before encryption existed', async () => {
    await prisma.$executeRaw`
      UPDATE email_provider_config SET brevo_api_key = ${'legacy-plaintext'} WHERE id = 1`;

    const results = await run();

    const stored = await storedKey();
    expect(stored).toMatch(/^enc:v1:/);
    expect(stored).not.toContain('legacy-plaintext');

    // And it still reads back as the same value through the app.
    const read = await prisma.email_provider_config.findUnique({ where: { id: 1 } });
    expect(read?.brevoApiKey).toBe('legacy-plaintext');

    const column = results.find((r) => r.column === 'email_provider_config.brevoApiKey');
    expect(column?.fromPlaintext).toBe(1);
  });

  it('leaves a value that is already under the primary key alone', async () => {
    await prisma.email_provider_config.update({
      where: { id: 1 },
      data: { brevoApiKey: 'already-current' },
    });
    const before = await storedKey();

    const results = await run();

    // Byte-identical: an unnecessary rewrite is not harmful, but it would mean
    // the script cannot tell an operator when a rotation is finished.
    expect(await storedKey()).toBe(before);
    const column = results.find((r) => r.column === 'email_provider_config.brevoApiKey');
    expect(column?.alreadyCurrent).toBe(1);
    expect(column?.fromRetiredKey).toBe(0);
  });

  it('counts a NULL column as nothing to do', async () => {
    const results = await run();
    const column = results.find((r) => r.column === 'email_provider_config.brevoApiKey');
    expect(column?.empty).toBe(1);
    expect(column?.fromPlaintext).toBe(0);
  });

  // The whole rotation, start to finish.
  it('moves every value onto a new key without re-entering any of them', async () => {
    await prisma.email_provider_config.update({
      where: { id: 1 },
      data: { brevoApiKey: 'rotate-me', resendApiKey: 'rotate-me-too' },
    });
    const oldKeyId = secretKeyIdOf(await storedKey());

    // Step 1-3: retire the old key, install the new one, restart. The ring is
    // rebuilt here in place of the restart.
    resetSecretKeyRing();
    process.env[PRIMARY_KEY_ENV] = KEY_NEW;
    process.env[RETIRED_KEYS_ENV] = KEY_OLD;

    const newKeyId = secretKeyRing().primary.id;
    expect(newKeyId).not.toBe(oldKeyId);

    // Before the script runs, the deployment is already fully working: the old
    // ciphertext still decrypts, because it names the key that wrote it. This
    // is what makes steps 3 and 4 separable.
    const beforeRewrap = await prisma.email_provider_config.findUnique({ where: { id: 1 } });
    expect(beforeRewrap?.brevoApiKey).toBe('rotate-me');

    // Step 4.
    const results = await run();

    expect(secretKeyIdOf(await storedKey())).toBe(newKeyId);
    const column = results.find((r) => r.column === 'email_provider_config.brevoApiKey');
    expect(column?.fromRetiredKey).toBe(1);

    // Step 5: with nothing left under the old key, it can be dropped -- and the
    // values are still readable without it.
    resetSecretKeyRing();
    delete process.env[RETIRED_KEYS_ENV];

    const afterRewrap = await prisma.email_provider_config.findUnique({ where: { id: 1 } });
    expect(afterRewrap?.brevoApiKey).toBe('rotate-me');
    expect(afterRewrap?.resendApiKey).toBe('rotate-me-too');

    // Re-running now reports nothing to do, which is how an operator knows the
    // retired key is safe to remove.
    const second = await run();
    const secondColumn = second.find((r) => r.column === 'email_provider_config.brevoApiKey');
    expect(secondColumn?.fromRetiredKey).toBe(0);
    expect(secondColumn?.alreadyCurrent).toBe(1);
  });

  it('covers every registered column, not only the ones with a service behind them', async () => {
    // tenants.googleClientSecret has no writer until v2-8. Registering it early
    // is only worth something if the rewrap reaches it, so a value planted
    // directly has to be picked up.
    const planted = encryptSecret('planted-oauth-secret', {
      model: 'tenants',
      field: 'googleClientSecret',
    });
    await prisma.$executeRaw`
      UPDATE tenants SET google_client_secret = ${planted} WHERE root_marker = 1`;

    resetSecretKeyRing();
    process.env[PRIMARY_KEY_ENV] = KEY_NEW;
    process.env[RETIRED_KEYS_ENV] = KEY_OLD;
    const newKeyId = secretKeyRing().primary.id;

    const results = await run();

    const [row] = await prisma.$queryRaw<{ google_client_secret: string }[]>`
      SELECT google_client_secret FROM tenants WHERE root_marker = 1`;
    expect(secretKeyIdOf(row.google_client_secret)).toBe(newKeyId);

    const column = results.find((r) => r.column === 'tenants.googleClientSecret');
    expect(column?.fromRetiredKey).toBe(1);
  });
});

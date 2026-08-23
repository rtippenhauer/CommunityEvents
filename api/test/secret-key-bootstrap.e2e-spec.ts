import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { TenantResolutionService } from '../src/common/tenant/tenant-resolution.service';
import { ensureDeploymentKey, storedKeyIds } from '../src/common/crypto/secret-key-bootstrap';
import { encryptSecret, secretKeyIdOf } from '../src/common/crypto/secret-cipher';
import {
  KEY_FILE_ENV,
  PRIMARY_KEY_ENV,
  RETIRED_KEYS_ENV,
  resetSecretKeyRing,
  secretKeyRing,
} from '../src/common/crypto/secret-key-ring';
import { createTestApp, truncateAllTables } from './utils/test-app';

/**
 * Whether a deployment may generate its own encryption key (v2-7).
 *
 * The interesting cases are the ones where getting it wrong is silent. A key
 * generated over a populated database produces an API that starts perfectly and
 * cannot read one of its own credentials, and the operator finds out when a
 * password-reset email fails. Every case below is really the same assertion:
 * generating is allowed exactly when there is nothing to lose.
 *
 * The key file is redirected to a temp directory throughout, so nothing here
 * touches a real deployment's key.
 */
describe('Encryption key bootstrap (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const KEY_A = process.env[PRIMARY_KEY_ENV] as string;
  const KEY_B = Buffer.from('communityevents-second-key-32byt').toString('base64');

  let keyDir: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    app.get(TenantResolutionService).clearCache();

    await prisma.email_provider_config.create({
      data: { id: 1, lastResetDate: new Date('2026-08-20') },
    });

    keyDir = mkdtempSync(join(tmpdir(), 'ce-key-'));
    process.env[KEY_FILE_ENV] = join(keyDir, 'secret-encryption.key');
  });

  afterEach(() => {
    // The ring is module state shared with the running app; leaving another
    // key in place would break every spec that follows.
    resetSecretKeyRing();
    process.env[PRIMARY_KEY_ENV] = KEY_A;
    delete process.env[RETIRED_KEYS_ENV];
    delete process.env[KEY_FILE_ENV];
    rmSync(keyDir, { recursive: true, force: true });
  });

  /** Removes every source of a key, as a deployment that has never run has. */
  const withNoKey = (): void => {
    resetSecretKeyRing();
    delete process.env[PRIMARY_KEY_ENV];
  };

  describe('a fresh deployment', () => {
    it('generates a key and writes it to the key file', async () => {
      withNoKey();

      await ensureDeploymentKey(prisma);

      const keyFile = process.env[KEY_FILE_ENV] as string;
      expect(existsSync(keyFile)).toBe(true);
      // Usable, not merely present.
      expect(secretKeyRing().primary.bytes).toHaveLength(32);
    });

    it('produces a key that can immediately encrypt and decrypt', async () => {
      withNoKey();
      await ensureDeploymentKey(prisma);

      await prisma.email_provider_config.update({
        where: { id: 1 },
        data: { brevoApiKey: 'written-under-the-generated-key' },
      });
      const read = await prisma.email_provider_config.findUnique({ where: { id: 1 } });
      expect(read?.brevoApiKey).toBe('written-under-the-generated-key');
    });

    it('treats legacy plaintext as nothing to lose', async () => {
      // A pre-v2-7 database holds plaintext, which no key can fail to read --
      // so generating is still safe, and the rewrap will bring it under the new
      // key. Refusing here would block exactly the upgrade path.
      await prisma.$executeRaw`
        UPDATE email_provider_config SET brevo_api_key = ${'legacy-plaintext'} WHERE id = 1`;
      withNoKey();

      await ensureDeploymentKey(prisma);
      expect(existsSync(process.env[KEY_FILE_ENV] as string)).toBe(true);
    });
  });

  describe('a populated deployment', () => {
    it('refuses to start with no key rather than generating one', async () => {
      await prisma.email_provider_config.update({
        where: { id: 1 },
        data: { brevoApiKey: 'a-real-key' },
      });
      withNoKey();

      await expect(ensureDeploymentKey(prisma)).rejects.toThrow(/holds secrets encrypted under/);
      // And it did not quietly write one on the way out.
      expect(existsSync(process.env[KEY_FILE_ENV] as string)).toBe(false);
    });

    it('refuses to start with a key that cannot read what is stored', async () => {
      await prisma.email_provider_config.update({
        where: { id: 1 },
        data: { brevoApiKey: 'written-under-key-A' },
      });

      resetSecretKeyRing();
      process.env[PRIMARY_KEY_ENV] = KEY_B;

      await expect(ensureDeploymentKey(prisma)).rejects.toThrow(/does not hold/);
      await expect(ensureDeploymentKey(prisma)).rejects.toThrow(/secrets:reset/);
    });

    it('starts when the old key is retired, and says the rotation is unfinished', async () => {
      await prisma.email_provider_config.update({
        where: { id: 1 },
        data: { brevoApiKey: 'written-under-key-A' },
      });

      resetSecretKeyRing();
      process.env[PRIMARY_KEY_ENV] = KEY_B;
      process.env[RETIRED_KEYS_ENV] = KEY_A;

      // Mid-rotation is a legitimate state, not an error: readable, but not done.
      await expect(ensureDeploymentKey(prisma)).resolves.toBeUndefined();
    });

    it('starts silently when everything is already under the primary key', async () => {
      await prisma.email_provider_config.update({
        where: { id: 1 },
        data: { brevoApiKey: 'current' },
      });

      await expect(ensureDeploymentKey(prisma)).resolves.toBeUndefined();
    });
  });

  describe('reading key ids out of the database', () => {
    it('finds them without decrypting, across every registered column', async () => {
      await prisma.email_provider_config.update({
        where: { id: 1 },
        data: { brevoApiKey: 'one' },
      });
      // tenants.googleClientSecret has no writer until v2-8; the check has to
      // reach it anyway, or a populated OAuth column would not be protected.
      const planted = encryptSecret('two', { model: 'tenants', field: 'googleClientSecret' });
      await prisma.$executeRaw`
        UPDATE tenants SET google_client_secret = ${planted} WHERE root_marker = 1`;

      const ids = await storedKeyIds(prisma);
      expect(ids).toEqual(new Set([secretKeyRing().primary.id]));
      expect(secretKeyIdOf(planted)).toBe(secretKeyRing().primary.id);
    });

    it('ignores legacy plaintext, which names no key', async () => {
      await prisma.$executeRaw`
        UPDATE email_provider_config SET brevo_api_key = ${'bare-value'} WHERE id = 1`;

      expect(await storedKeyIds(prisma)).toEqual(new Set());
    });
  });
});

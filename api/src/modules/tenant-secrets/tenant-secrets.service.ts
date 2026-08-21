import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma/prisma.service';
import { requireTenantId } from '../../common/tenant/tenant-store';
import {
  isTenantSecretKey,
  TENANT_SECRET_ENV_FALLBACK,
  TENANT_SECRET_KEYS,
  TENANT_SECRET_LABELS,
  type TenantSecretKey,
} from './tenant-secret-keys';

/** Where a resolved secret came from — reported to admins, never with a value. */
export type TenantSecretSource = 'tenant' | 'deployment' | 'unset';

export interface TenantSecretStatus {
  readonly key: TenantSecretKey;
  readonly label: string;
  readonly source: TenantSecretSource;
  /** The env var a community inherits from when it sets nothing of its own. */
  readonly deploymentEnvVar: string;
}

/**
 * Reads and writes a community's own credentials (v2-7).
 *
 * The values live in `tenant_secrets`, which the encryption extension keeps as
 * ciphertext — so this service handles plaintext and the database never does.
 * Nothing here calls `encryptSecret`; if it did, that would be the bug.
 *
 * Resolution is most-specific-first, matching how v2-6 resolved contact
 * addresses: the community's own row, then the deployment's env var, then
 * nothing. "Nothing" is a real answer — a missing geocoding key means geocoding
 * is off, not that the request fails.
 *
 * ## No cache, deliberately
 *
 * Each `resolve()` is a primary-key-indexed read of one small row, on paths
 * that are already about to make an HTTP call to Google or Anthropic — the
 * round trip this saves is the cheapest part of what follows. A cache would
 * need to be keyed per tenant and invalidated on write, and a stale credential
 * fails in a way that looks like the provider rejecting the account.
 */
@Injectable()
export class TenantSecretsService {
  private readonly logger = new Logger(TenantSecretsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * The value this community should use for `key`, or null if neither it nor
   * the deployment has one.
   *
   * Reads the tenant's row through the scoping extension, so the ambient
   * request tenant is the one answered for. There is no cross-tenant form on
   * purpose: a sweep that needs a specific community's key should re-enter
   * `runWithTenant`, the same rule branding follows.
   */
  async resolve(key: TenantSecretKey): Promise<string | null> {
    const row = await this.prisma.tenant_secrets.findFirst({
      where: { secretKey: key },
      select: { secretValue: true },
    });

    // An empty stored value means the row exists but holds nothing, which is
    // what `clear()` avoids by deleting instead. Treated as unset anyway, so a
    // row written by hand cannot produce an empty API key sent to Google.
    if (row?.secretValue) return row.secretValue;

    const fromEnv = this.config.get<string>(TENANT_SECRET_ENV_FALLBACK[key]);
    return fromEnv && fromEnv.trim() ? fromEnv : null;
  }

  /** Where `key` currently resolves from, without disclosing the value. */
  async sourceOf(key: TenantSecretKey): Promise<TenantSecretSource> {
    const row = await this.prisma.tenant_secrets.findFirst({
      where: { secretKey: key },
      select: { secretValue: true },
    });
    if (row?.secretValue) return 'tenant';

    const fromEnv = this.config.get<string>(TENANT_SECRET_ENV_FALLBACK[key]);
    return fromEnv && fromEnv.trim() ? 'deployment' : 'unset';
  }

  /**
   * Every key and where it resolves from, for the admin screen.
   *
   * Returns statuses rather than values because there is no reason to send a
   * credential back to a browser: an admin who can set one does not need to
   * read it, and a value in a response is a value in a log, a proxy buffer and
   * a browser cache.
   */
  async list(): Promise<TenantSecretStatus[]> {
    const rows = await this.prisma.tenant_secrets.findMany({
      select: { secretKey: true, secretValue: true },
    });
    const own = new Map(rows.map((row) => [row.secretKey, row.secretValue]));

    return TENANT_SECRET_KEYS.map((key) => {
      const fromEnv = this.config.get<string>(TENANT_SECRET_ENV_FALLBACK[key]);
      const source: TenantSecretSource = own.get(key)
        ? 'tenant'
        : fromEnv && fromEnv.trim()
          ? 'deployment'
          : 'unset';

      return {
        key,
        label: TENANT_SECRET_LABELS[key],
        source,
        deploymentEnvVar: TENANT_SECRET_ENV_FALLBACK[key],
      };
    });
  }

  /**
   * Sets this community's own value for `key`.
   *
   * Names the tenant by hand for the same reason `AppConfigService.setConfig`
   * does, and only for that reason: `upsert.where` has to identify a row
   * uniquely, the unique key is the compound `(tenant_id, secret_key)`, and
   * Prisma spells a compound key as one nested object the scoping extension
   * cannot merge a separate `tenantId` into. `requireTenantId` throws rather
   * than guessing when there is no tenant in context.
   */
  async set(key: TenantSecretKey, value: string, updatedBy: number): Promise<void> {
    const tenantId = requireTenantId('tenant secret update');

    await this.prisma.tenant_secrets.upsert({
      where: { tenantId_secretKey: { tenantId, secretKey: key } },
      update: { secretValue: value, updatedBy },
      create: { secretKey: key, secretValue: value, updatedBy },
    });

    // The value is never logged, here or anywhere. That it changed is worth a
    // line -- it is the kind of change that explains an outage an hour later.
    this.logger.log(`Tenant ${tenantId} set its own ${key}.`);
  }

  /**
   * Drops this community's own value, so `key` falls back to the deployment's.
   *
   * Deletes rather than blanking: a resolve() treats an empty value as unset
   * either way, but an empty row reads as "configured" in the listing, which is
   * the opposite of what clearing means.
   */
  async clear(key: TenantSecretKey): Promise<void> {
    const tenantId = requireTenantId('tenant secret clear');
    await this.prisma.tenant_secrets.deleteMany({ where: { secretKey: key } });
    this.logger.log(`Tenant ${tenantId} cleared its own ${key}; falling back to the deployment.`);
  }

  /** Re-exported so callers validating a path segment need one import. */
  static isKnownKey(key: string): key is TenantSecretKey {
    return isTenantSecretKey(key);
  }
}

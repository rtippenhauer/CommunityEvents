import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma/prisma.service';
import {
  isOnDeploymentDomain as domainIsOnDeployment,
  normalizeTenantDomain,
  resolveRootTenantDomain,
} from '../utils/tenant-domain.util';
import { currentTenantId } from './tenant-store';
import { TenantContext } from './tenant-context';

/**
 * Why a resolution can fail, kept separate from the HTTP response so the
 * middleware decides status codes and this service only reports facts. The
 * health endpoint consumes the same outcomes without any of them throwing.
 */
export type TenantResolution =
  | { outcome: 'resolved'; tenant: TenantContext }
  | { outcome: 'suspended'; tenant: TenantContext }
  | { outcome: 'unrecognized' }
  | { outcome: 'not-configured' };

interface CacheEntry {
  resolution: TenantResolution;
  expiresAt: number;
}

// Short enough that suspending a tenant or correcting a domain takes effect
// without a restart, long enough to keep a hot path off the database.
const DEFAULT_TTL_MS = 30_000;

// The cache is keyed by whatever arrived in the Host header, which is
// attacker-controlled and unbounded — a few thousand requests with random
// hosts would otherwise grow this Map forever. Real deployments have a
// handful of tenants, so this ceiling is never reached by legitimate traffic.
const MAX_ENTRIES = 500;

/**
 * Resolves a Host header to a tenant (REQ-TENANT-01.2).
 *
 * Lookups go through normalizeTenantDomain — the same function bootstrap uses
 * when it writes the root tenant's domain — so `www.<domain>` and `<domain>`
 * cannot resolve differently, and a seeded domain cannot become unreachable
 * because resolution normalised it differently from the way it was stored.
 */
@Injectable()
export class TenantResolutionService {
  private readonly logger = new Logger(TenantResolutionService.name);
  private readonly cache = new Map<string, CacheEntry>();
  /**
   * tenant id -> that tenant's own domain. Feeds both baseUrlFor (which turns
   * it into a URL) and isOnDeploymentDomain (which compares it against this
   * deployment's), so the two cannot disagree about where a community lives.
   */
  private readonly domainCache = new Map<
    number,
    { domain: string; isRoot: boolean; expiresAt: number }
  >();
  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const configured = Number(config.get<string>('TENANT_CACHE_TTL_MS'));
    this.ttlMs = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TTL_MS;
  }

  /**
   * `host` is the raw Host header (or any URL/host string). Never throws for
   * an unknown or malformed host — that is a normal outcome, not an error.
   */
  async resolve(host: string | undefined): Promise<TenantResolution> {
    const domain = normalizeTenantDomain(host ?? '');

    const cached = this.cache.get(domain);
    if (cached && cached.expiresAt > Date.now()) return cached.resolution;

    const resolution = await this.lookup(domain);
    this.remember(domain, resolution);
    return resolution;
  }

  /**
   * Drops cached resolutions. Called by tests; also the hook for an admin
   * action that changes a tenant's domain or status and should not wait out
   * the TTL.
   */
  clearCache(): void {
    this.cache.clear();
    this.domainCache.clear();
  }

  /**
   * The absolute base URL of a tenant, for links that leave the application --
   * verification and password-reset emails, invite links, event links,
   * calendar feeds.
   *
   * Every one of those used to be built from the single `APP_URL` env var. That
   * was correct while there was one host, and became a broken flow rather than a
   * cosmetic problem in v2-6: the token lookups behind those links are scoped to
   * the tenant now, so a link that lands a member of one community on another
   * community's host finds no token and fails. A member of a non-root tenant
   * could not verify an address, reset a password or redeem an invite.
   *
   * `tenantId` is explicit wherever the caller is not inside the request that
   * owns the row -- the reminder sweeps run under `runUnscoped` and mail several
   * tenants' members in one pass, so each message has to take the URL from its
   * own event rather than from an ambient context that is deliberately absent.
   * Omitting it uses the ambient tenant, which is what an ordinary request wants.
   *
   * The scheme comes from `APP_URL`, since that is the only place the deployment
   * states whether it is served over TLS; only the host is per tenant.
   *
   * Falls back to `APP_URL` (loudly) rather than throwing if the tenant cannot be
   * resolved: this is called from inside email composition, and a link pointing
   * at the wrong host is a better failure than an unsent password-reset mail.
   */
  async baseUrlFor(tenantId?: number): Promise<string> {
    const appUrl = this.config.get<string>('APP_URL', 'http://localhost:8081');
    const id = tenantId ?? currentTenantId() ?? undefined;

    if (id === undefined) {
      this.logger.error(
        'baseUrlFor called with no tenant and no ambient context; falling back to APP_URL. ' +
          'Links in this message may point at the wrong community.',
      );
      return appUrl;
    }

    const domain = await this.domainFor(id);
    if (!domain) {
      this.logger.error(`No tenant ${id} when building a URL; falling back to APP_URL.`);
      return appUrl;
    }

    let protocol = 'https:';
    try {
      protocol = new URL(appUrl).protocol;
    } catch {
      // APP_URL misconfigured; https is the safe assumption for a real link.
    }

    return `${protocol}//${domain}`;
  }

  /**
   * A tenant's own domain, cached on the same short TTL as resolution.
   *
   * Null when no such tenant exists. Callers decide what that means -- it is a
   * broken reference rather than a normal outcome, and the callers here want
   * different fallbacks.
   */
  async domainFor(tenantId: number): Promise<string | null> {
    return (await this.identityFor(tenantId))?.domain ?? null;
  }

  /**
   * A tenant's domain and whether it is the root, cached together because the
   * two callers below need one each and neither is worth a second query.
   */
  private async identityFor(
    tenantId: number,
  ): Promise<{ domain: string; isRoot: boolean } | null> {
    const cached = this.domainCache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached;

    const tenant = await this.prisma.tenants.findUnique({
      where: { id: tenantId },
      select: { domain: true, isRoot: true },
    });
    if (!tenant) return null;

    this.domainCache.set(tenantId, {
      domain: tenant.domain,
      isRoot: tenant.isRoot,
      expiresAt: Date.now() + this.ttlMs,
    });
    return tenant;
  }

  /**
   * Whether this community lives on the deployment's own domain (v2-12).
   *
   * The single question behind which Google redirect URI applies, whether the
   * OAuth callback needs the handoff hop, and whether the deployment's email
   * credentials may be fallen back on. See `domainIsOnDeployment` for why it is
   * derived from the domain rather than stored as a flag on `tenants`.
   *
   * The deployment's own domain comes from `resolveRootTenantDomain` -- env,
   * the same source `bootstrap.ts` writes the root tenant's `domain` column
   * from, rather than a query for the `is_root` row. That is what makes this
   * answerable without a second lookup, and the two agree by construction:
   * bootstrap writes that column from this value and overwrites it on every run.
   *
   * An unknown tenant is false -- the no-fallback side, matching the predicate.
   */
  async isOnDeploymentDomain(tenantId: number): Promise<boolean> {
    const tenant = await this.identityFor(tenantId);
    if (!tenant) {
      this.logger.error(
        `No tenant ${tenantId} when asking whose domain it is; treating it as ` +
          'bringing its own, which withholds the credentials of this deployment.',
      );
      return false;
    }

    // The root tenant is the deployment, so it is answered by `is_root` rather
    // than by comparing strings. The comparison would usually agree -- bootstrap
    // writes this column from the same env value -- but "usually" is the wrong
    // guarantee for the tenant that owns the deployment: if the two ever drift,
    // a string compare quietly stops the operator's own community sending mail
    // and tells its admin to register a redirect URI nobody registered.
    if (tenant.isRoot) return true;

    return domainIsOnDeployment(tenant.domain, this.deploymentDomain());
  }

  /** This deployment's own domain, bare and normalised. */
  private deploymentDomain(): string {
    return resolveRootTenantDomain({
      ROOT_TENANT_URL: this.config.get<string>('ROOT_TENANT_URL'),
      APP_URL: this.config.get<string>('APP_URL'),
    });
  }

  private async lookup(domain: string): Promise<TenantResolution> {
    // An empty domain (no Host header at all, or one that normalised away)
    // cannot match a row — `domain` is NOT NULL and non-empty on every tenant.
    // Skipping the query keeps a malformed request off the database, but it
    // still has to fall through to the not-configured check below so a broken
    // deployment is reported as broken rather than as a bad request.
    const tenant = domain
      ? await this.prisma.tenants.findUnique({
          where: { domain },
          select: { id: true, slug: true, domain: true, isRoot: true, status: true },
        })
      : null;

    if (tenant) {
      return tenant.status === 'suspended'
        ? { outcome: 'suspended', tenant }
        : { outcome: 'resolved', tenant };
    }

    // No row matched. Before calling this an unrecognized domain, check
    // whether the table has any tenants at all: a database that has been
    // migrated and seeded but never bootstrapped has none, and every single
    // request would otherwise 404 with no hint that the install is unfinished
    // rather than the domain being wrong.
    const anyTenant = await this.prisma.tenants.findFirst({ select: { id: true } });
    if (!anyTenant) {
      this.logger.error(
        'No tenants exist in the database. This deployment has been migrated and ' +
          'seeded but not bootstrapped — run `node dist/bootstrap.js` to create the ' +
          'root tenant. Every request will fail until then.',
      );
      return { outcome: 'not-configured' };
    }

    return { outcome: 'unrecognized' };
  }

  private remember(domain: string, resolution: TenantResolution): void {
    // Negative outcomes are cached too, deliberately: without that, a stream
    // of requests for unknown hosts is a stream of database queries.
    if (this.cache.size >= MAX_ENTRIES) {
      // Map iterates in insertion order, so the first key is the oldest
      // *inserted* entry. Not a true LRU — evicting roughly-oldest is enough
      // for a cache this size, and a real LRU here would be machinery in
      // service of a case that legitimate traffic never reaches.
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(domain, { resolution, expiresAt: Date.now() + this.ttlMs });
  }
}

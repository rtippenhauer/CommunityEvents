import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma/prisma.service';
import { normalizeTenantDomain } from '../utils/tenant-domain.util';
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
  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
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

import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { TenantResolutionService } from './tenant-resolution.service';

/**
 * Host-header -> tenant resolution (REQ-TENANT-01.2).
 *
 * What matters here is not "a lookup returns a row" but the three things that
 * go wrong: a host nobody claims, a deployment with no tenants at all, and a
 * cache that either serves stale rows or stops being a cache.
 */
describe('TenantResolutionService', () => {
  const rootTenant = {
    id: 1,
    slug: 'root',
    domain: 'communityeventsproject.com',
    isRoot: true,
    status: 'active' as 'active' | 'suspended',
  };

  type Row = typeof rootTenant;

  let findUnique: ReturnType<typeof vi.fn>;
  let findFirst: ReturnType<typeof vi.fn>;

  // Only the two calls the service actually makes; anything else should fail
  // loudly rather than return a silent undefined.
  const prismaWith = (rows: Row[]): PrismaService => {
    findUnique = vi.fn(
      async ({ where }: { where: { domain: string } }) =>
        rows.find((r) => r.domain === where.domain) ?? null,
    );
    findFirst = vi.fn(async () => rows[0] ?? null);
    return { tenants: { findUnique, findFirst } } as unknown as PrismaService;
  };

  const configWith = (ttl?: string): ConfigService =>
    ({ get: () => ttl }) as unknown as ConfigService;

  const make = (rows: Row[], ttl?: string) =>
    new TenantResolutionService(prismaWith(rows), configWith(ttl));

  beforeEach(() => {
    // The not-configured branch logs an error by design; keep it out of the
    // test output while still asserting on it below.
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('the root domain and its www. variant', () => {
    it('resolves the bare domain', async () => {
      const service = make([rootTenant]);

      const result = await service.resolve('communityeventsproject.com');

      expect(result.outcome).toBe('resolved');
      expect(result).toMatchObject({ tenant: { id: 1, slug: 'root', isRoot: true } });
    });

    it('resolves the www. variant to the same tenant', async () => {
      // The requirement stated directly. The column physically cannot hold the
      // www. form, so this only passes if the lookup normalises -- which is
      // why it shares normalizeTenantDomain with the code that writes the row.
      const service = make([rootTenant]);

      const bare = await service.resolve('communityeventsproject.com');
      const www = await service.resolve('www.communityeventsproject.com');

      expect(www).toEqual(bare);
      expect(www.outcome).toBe('resolved');
    });

    it('resolves a host that carries a port', async () => {
      const service = make([rootTenant]);

      expect((await service.resolve('communityeventsproject.com:3000')).outcome).toBe('resolved');
    });
  });

  describe('hosts with no tenant', () => {
    it('reports an unrecognized host when other tenants exist', async () => {
      const service = make([rootTenant]);

      expect(await service.resolve('nope.example.com')).toEqual({ outcome: 'unrecognized' });
    });

    it('reports an unrecognized subdomain rather than falling back to the root', async () => {
      // Sub-communities are explicitly out of scope for REQ-TENANT-01: an
      // unknown subdomain is just an unknown host, with no special-casing that
      // would quietly hand it the root tenant's data.
      const service = make([rootTenant]);

      expect(await service.resolve('sub1.communityeventsproject.com')).toEqual({
        outcome: 'unrecognized',
      });
    });

    it('reports a missing Host header as unrecognized, without querying by domain', async () => {
      const service = make([rootTenant]);

      expect(await service.resolve(undefined)).toEqual({ outcome: 'unrecognized' });
      // No row can have an empty domain, so the lookup is skipped entirely.
      expect(findUnique).not.toHaveBeenCalled();
    });
  });

  describe('a deployment that was never bootstrapped', () => {
    it('reports not-configured rather than unrecognized when the table is empty', async () => {
      // Migrated and seeded but not bootstrapped. Every request would
      // otherwise 404 and look like a DNS mistake instead of an unfinished
      // install -- the gap called out for this item.
      const service = make([]);

      expect(await service.resolve('communityeventsproject.com')).toEqual({
        outcome: 'not-configured',
      });
    });

    it('logs loudly, since nothing else will say why the site is down', async () => {
      const service = make([]);

      await service.resolve('communityeventsproject.com');

      expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('bootstrap'));
    });

    it('reports not-configured even for a missing Host header', async () => {
      const service = make([]);

      expect(await service.resolve(undefined)).toEqual({ outcome: 'not-configured' });
    });
  });

  describe('suspended tenants', () => {
    it('resolves the row but reports it as suspended', async () => {
      const service = make([{ ...rootTenant, status: 'suspended' }]);

      const result = await service.resolve('communityeventsproject.com');

      expect(result.outcome).toBe('suspended');
      expect(result).toMatchObject({ tenant: { id: 1 } });
    });
  });

  describe('caching', () => {
    it('serves a repeat lookup without touching the database', async () => {
      const service = make([rootTenant]);

      await service.resolve('communityeventsproject.com');
      await service.resolve('communityeventsproject.com');

      expect(findUnique).toHaveBeenCalledTimes(1);
    });

    it('caches the www. and bare forms as one entry', async () => {
      const service = make([rootTenant]);

      await service.resolve('communityeventsproject.com');
      await service.resolve('www.communityeventsproject.com');

      expect(findUnique).toHaveBeenCalledTimes(1);
    });

    it('caches misses too, so unknown hosts cannot be used to hammer the database', async () => {
      const service = make([rootTenant]);

      await service.resolve('nope.example.com');
      await service.resolve('nope.example.com');

      expect(findUnique).toHaveBeenCalledTimes(1);
      expect(findFirst).toHaveBeenCalledTimes(1);
    });

    it('re-queries once the TTL has passed', async () => {
      vi.useFakeTimers();
      const service = make([rootTenant], '1000');

      await service.resolve('communityeventsproject.com');
      vi.advanceTimersByTime(1001);
      await service.resolve('communityeventsproject.com');

      expect(findUnique).toHaveBeenCalledTimes(2);
    });

    it('picks up a suspension after the TTL rather than needing a restart', async () => {
      vi.useFakeTimers();
      const rows: Row[] = [{ ...rootTenant }];
      const service = new TenantResolutionService(prismaWith(rows), configWith('1000'));

      expect((await service.resolve('communityeventsproject.com')).outcome).toBe('resolved');
      rows[0].status = 'suspended';
      vi.advanceTimersByTime(1001);

      expect((await service.resolve('communityeventsproject.com')).outcome).toBe('suspended');
    });

    it('clearCache forces the next lookup back to the database', async () => {
      const service = make([rootTenant]);

      await service.resolve('communityeventsproject.com');
      service.clearCache();
      await service.resolve('communityeventsproject.com');

      expect(findUnique).toHaveBeenCalledTimes(2);
    });

    it('bounds itself, so attacker-supplied Host headers cannot grow it forever', async () => {
      // The cache key is whatever arrived in the Host header. Without a
      // ceiling this Map is an unbounded cache of arbitrary strings.
      const service = make([rootTenant]);

      await service.resolve('first.example.com');
      for (let i = 0; i < 600; i++) {
        await service.resolve('flood-' + i + '.example.com');
      }
      findUnique.mockClear();
      await service.resolve('first.example.com');

      // Evicted by the flood, so it has to be looked up again.
      expect(findUnique).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * Whose domain a community is on (v2-12).
 *
 * One predicate decides the Google redirect URI, whether the OAuth callback
 * needs the handoff hop, and whether the deployment's email credentials may be
 * fallen back on -- so what is worth testing here is that it answers from the
 * tenant's own `domain` column and from this deployment's own domain, and that
 * the answer for a community nobody can find is the withholding one.
 */
describe('TenantResolutionService — whose domain a community is on', () => {
  const rows = [
    { id: 1, domain: 'communityeventsproject.com', isRoot: true },
    { id: 2, domain: 'dayton.communityeventsproject.com', isRoot: false },
    { id: 3, domain: 'dinnerbears.com', isRoot: false },
  ];

  const make = (env: Record<string, string | undefined>) => {
    const prisma = {
      tenants: {
        findUnique: vi.fn(async ({ where }: { where: { id: number } }) => {
          const row = rows.find((r) => r.id === where.id);
          return row ? { domain: row.domain, isRoot: row.isRoot } : null;
        }),
        findFirst: vi.fn(async () => rows[0]),
      },
    } as unknown as PrismaService;

    const config = {
      get: (key: string, fallback?: string) => env[key] ?? fallback,
    } as unknown as ConfigService;

    return new TenantResolutionService(prisma, config);
  };

  const onProd = () => make({ APP_URL: 'https://www.communityeventsproject.com' });

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('says a community on a subdomain of the deployment is on the deployment domain', async () => {
    expect(await onProd().isOnDeploymentDomain(2)).toBe(true);
  });

  it('says a community on its own domain is not', async () => {
    expect(await onProd().isOnDeploymentDomain(3)).toBe(false);
  });

  it('says the root tenant is on the deployment domain — it is the deployment', async () => {
    expect(await onProd().isOnDeploymentDomain(1)).toBe(true);
  });

  it('still says yes for the root tenant when its domain and APP_URL have drifted', async () => {
    // The root tenant IS the deployment, so this is answered by `is_root`
    // rather than by comparing strings. A drift here -- a stale APP_URL, a
    // domain corrected by hand -- would otherwise stop the operator's own
    // community sending mail and tell its admin to register a redirect URI
    // nobody registered.
    const svc = make({ APP_URL: 'https://something-else.example' });
    expect(await svc.isOnDeploymentDomain(1)).toBe(true);
    expect(await svc.isOnDeploymentDomain(2)).toBe(false);
  });

  it('prefers ROOT_TENANT_URL over APP_URL, matching where the root domain is written from', async () => {
    // bootstrap.ts resolves the root tenant's domain the same way. If these two
    // disagreed, a community could be told to register one redirect URI while
    // the flow sent another.
    const svc = make({
      ROOT_TENANT_URL: 'https://dinnerbears.com',
      APP_URL: 'https://www.communityeventsproject.com',
    });
    expect(await svc.isOnDeploymentDomain(3)).toBe(true);
    expect(await svc.isOnDeploymentDomain(2)).toBe(false);
  });

  it('withholds the deployment credentials for a tenant that cannot be found', async () => {
    // False is the no-fallback side deliberately: a broken reference must not
    // hand out this deployment's Google app or its Brevo account.
    expect(await onProd().isOnDeploymentDomain(999)).toBe(false);
  });

  it('caches the domain, so asking repeatedly costs one lookup', async () => {
    const svc = onProd();
    const prisma = (svc as unknown as { prisma: PrismaService }).prisma;
    await svc.isOnDeploymentDomain(2);
    await svc.isOnDeploymentDomain(2);
    await svc.baseUrlFor(2);
    expect((prisma.tenants.findUnique as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('builds a base URL from the same cached domain', async () => {
    expect(await onProd().baseUrlFor(3)).toBe('https://dinnerbears.com');
  });
});

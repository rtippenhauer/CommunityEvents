import { describe, expect, it, vi } from 'vitest';
import { TenantOAuthService } from './tenant-oauth.service';
import { ConfigService } from '@nestjs/config';
import { TenantResolutionService } from './tenant-resolution.service';
import type { PrismaService } from '../../database/prisma/prisma.service';
import { runWithTenant } from './tenant-store';

type TenantRow = {
  googleClientId?: string | null;
  googleClientSecret?: string | null;
  facebookAppId?: string | null;
  facebookAppSecret?: string | null;
};

/**
 * Records what was selected as well as what was returned: half the point of
 * `offeredProviders` is that it never reads a secret column, and that is only
 * observable from the query it builds.
 */
function stubPrisma(rows: Record<number, TenantRow>) {
  const selects: Array<Record<string, boolean>> = [];
  const prisma = {
    tenants: {
      findUnique: ({
        where,
        select,
      }: {
        where: { id: number };
        select: Record<string, boolean>;
      }) => {
        selects.push(select);
        const row = rows[where.id];
        if (!row) return Promise.resolve(null);
        return Promise.resolve(
          Object.fromEntries(Object.keys(select).map((key) => [key, row[key as keyof TenantRow] ?? null])),
        );
      },
    },
  } as unknown as PrismaService;
  return { prisma, selects };
}

/**
 * The two collaborators googleRedirectUri needs (v2-12). Every test below is
 * about the credential reads instead, so they are stubbed once here rather than
 * threaded through each construction.
 */
function makeService(prisma: PrismaService): TenantOAuthService {
  const config = {
    getOrThrow: () => 'https://www.communityeventsproject.com',
  } as unknown as ConfigService;
  const resolution = {
    isOnDeploymentDomain: async () => true,
    baseUrlFor: async () => 'https://www.communityeventsproject.com',
  } as unknown as TenantResolutionService;
  return new TenantOAuthService(prisma, config, resolution);
}

const CONFIGURED: TenantRow = {
  googleClientId: 'google-id',
  googleClientSecret: 'google-secret',
  facebookAppId: 'fb-id',
  facebookAppSecret: 'fb-secret',
};

describe('TenantOAuthService (REQ-TENANT-01.9)', () => {
  describe('offeredProviders', () => {
    it('offers nothing for a community with no credentials', async () => {
      const { prisma } = stubPrisma({ 1: {} });
      const service = makeService(prisma);
      expect(await service.offeredProviders(1)).toEqual({ google: false, facebook: false });
    });

    it('offers each provider the community has registered', async () => {
      const { prisma } = stubPrisma({ 1: CONFIGURED, 2: { googleClientId: 'g', googleClientSecret: 's' } });
      const service = makeService(prisma);

      expect(await service.offeredProviders(1)).toEqual({ google: true, facebook: true });
      expect(await service.offeredProviders(2)).toEqual({ google: true, facebook: false });
    });

    // This runs on every app load. Reading a secret to answer it would decrypt
    // an operator's credential on a page render, which is the hop v2-7 exists
    // to close.
    it('never selects a secret column', async () => {
      const { prisma, selects } = stubPrisma({ 1: CONFIGURED });
      await makeService(prisma).offeredProviders(1);

      expect(selects).toHaveLength(1);
      expect(Object.keys(selects[0])).toEqual(['googleClientId', 'facebookAppId']);
    });

    it('takes the ambient tenant when none is passed', async () => {
      const { prisma } = stubPrisma({ 9: CONFIGURED });
      const service = makeService(prisma);

      const offered = await runWithTenant(9, async () => await service.offeredProviders());
      expect(offered).toEqual({ google: true, facebook: true });
    });

    // The caller is rendering a login page; a 500 there is worse than a page
    // with no social buttons on it.
    it('reports none offered, loudly, with no tenant at all', async () => {
      const { prisma } = stubPrisma({});
      const service = makeService(prisma);
      const logged = vi.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

      expect(await service.offeredProviders()).toEqual({ google: false, facebook: false });
      expect(logged).toHaveBeenCalledOnce();
    });

    it('offers nothing for a community that does not exist', async () => {
      const { prisma } = stubPrisma({});
      expect(await makeService(prisma).offeredProviders(404)).toEqual({
        google: false,
        facebook: false,
      });
    });
  });

  describe('credentials', () => {
    it('returns the pair a community registered', async () => {
      const { prisma } = stubPrisma({ 1: CONFIGURED });
      const service = makeService(prisma);

      expect(await service.googleCredentials(1)).toEqual({
        clientId: 'google-id',
        clientSecret: 'google-secret',
      });
      expect(await service.facebookCredentials(1)).toEqual({
        clientId: 'fb-id',
        clientSecret: 'fb-secret',
      });
    });

    it('returns null when the community registered nothing', async () => {
      const { prisma } = stubPrisma({ 1: {} });
      const service = makeService(prisma);
      expect(await service.googleCredentials(1)).toBeNull();
      expect(await service.facebookCredentials(1)).toBeNull();
    });

    // A half-filled row would otherwise send a member to a consent screen and
    // fail the token exchange after they had already granted access.
    it.each([
      ['id only', { googleClientId: 'g' }],
      ['secret only', { googleClientSecret: 's' }],
    ])('treats a %s row as switched off, and says so', async (_label, row) => {
      const { prisma } = stubPrisma({ 1: row });
      const service = makeService(prisma);
      const logged = vi.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

      expect(await service.googleCredentials(1)).toBeNull();
      expect(logged).toHaveBeenCalledOnce();
    });

    it('does not log for a row with neither half set', async () => {
      const { prisma } = stubPrisma({ 1: {} });
      const service = makeService(prisma);
      const logged = vi.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

      await service.googleCredentials(1);
      expect(logged).not.toHaveBeenCalled();
    });
  });

  describe('facebookAppId', () => {
    it('is the community own app id, or null', async () => {
      const { prisma } = stubPrisma({ 1: CONFIGURED, 2: {} });
      const service = makeService(prisma);

      expect(await service.facebookAppId(1)).toBe('fb-id');
      expect(await service.facebookAppId(2)).toBeNull();
      expect(await service.facebookAppId(404)).toBeNull();
    });
  });
});

/**
 * Which redirect URI a community's Google flow uses (v2-12).
 *
 * Both OAuth legs and the admin screen read this one method, so what it
 * returns is what the operator is told to register and what Google is asked to
 * match. The two must be the same string or the flow fails with a
 * `redirect_uri_mismatch` that names neither value.
 */
describe('TenantOAuthService — googleRedirectUri', () => {
  const APP_URL = 'https://www.communityeventsproject.com';

  /** `onDeployment` stands in for the domain comparison, tested in its own spec. */
  const make = (onDeployment: boolean, ownHost = 'https://dinnerbears.com') => {
    const config = { getOrThrow: () => APP_URL } as unknown as ConfigService;
    const resolution = {
      isOnDeploymentDomain: async () => onDeployment,
      baseUrlFor: async () => ownHost,
    } as unknown as TenantResolutionService;
    return new TenantOAuthService({} as unknown as PrismaService, config, resolution);
  };

  it('gives a community on the deployment domain the one registered URI', async () => {
    expect(await make(true).googleRedirectUri(1)).toBe(
      'https://www.communityeventsproject.com/api/v1/auth/google/callback',
    );
  });

  it('gives a community on its own domain its own host', async () => {
    expect(await make(false).googleRedirectUri(3)).toBe(
      'https://dinnerbears.com/api/v1/auth/google/callback',
    );
  });

  it('never points a community on its own domain at the deployment', async () => {
    // Row 4 of v2-8's table, which policy disallows and Google could not honour
    // anyway: registering a redirect URI needs Search Console ownership of the
    // domain, so this community cannot register the deployment's URI.
    expect(await make(false).googleRedirectUri(3)).not.toContain('communityeventsproject.com');
  });

  it('keeps the path this deployment actually serves', async () => {
    // The path is ours and never varies -- only the host does. A drift here is
    // a 404 on the callback rather than a mismatch, which looks like a
    // different bug entirely.
    for (const onDeployment of [true, false]) {
      expect(await make(onDeployment).googleRedirectUri(1)).toMatch(
        /\/api\/v1\/auth\/google\/callback$/,
      );
    }
  });
});

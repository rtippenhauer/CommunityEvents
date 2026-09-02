import { describe, expect, it, vi } from 'vitest';
import { TenantOAuthService } from './tenant-oauth.service';
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
      const service = new TenantOAuthService(prisma);
      expect(await service.offeredProviders(1)).toEqual({ google: false, facebook: false });
    });

    it('offers each provider the community has registered', async () => {
      const { prisma } = stubPrisma({ 1: CONFIGURED, 2: { googleClientId: 'g', googleClientSecret: 's' } });
      const service = new TenantOAuthService(prisma);

      expect(await service.offeredProviders(1)).toEqual({ google: true, facebook: true });
      expect(await service.offeredProviders(2)).toEqual({ google: true, facebook: false });
    });

    // This runs on every app load. Reading a secret to answer it would decrypt
    // an operator's credential on a page render, which is the hop v2-7 exists
    // to close.
    it('never selects a secret column', async () => {
      const { prisma, selects } = stubPrisma({ 1: CONFIGURED });
      await new TenantOAuthService(prisma).offeredProviders(1);

      expect(selects).toHaveLength(1);
      expect(Object.keys(selects[0])).toEqual(['googleClientId', 'facebookAppId']);
    });

    it('takes the ambient tenant when none is passed', async () => {
      const { prisma } = stubPrisma({ 9: CONFIGURED });
      const service = new TenantOAuthService(prisma);

      const offered = await runWithTenant(9, async () => await service.offeredProviders());
      expect(offered).toEqual({ google: true, facebook: true });
    });

    // The caller is rendering a login page; a 500 there is worse than a page
    // with no social buttons on it.
    it('reports none offered, loudly, with no tenant at all', async () => {
      const { prisma } = stubPrisma({});
      const service = new TenantOAuthService(prisma);
      const logged = vi.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

      expect(await service.offeredProviders()).toEqual({ google: false, facebook: false });
      expect(logged).toHaveBeenCalledOnce();
    });

    it('offers nothing for a community that does not exist', async () => {
      const { prisma } = stubPrisma({});
      expect(await new TenantOAuthService(prisma).offeredProviders(404)).toEqual({
        google: false,
        facebook: false,
      });
    });
  });

  describe('credentials', () => {
    it('returns the pair a community registered', async () => {
      const { prisma } = stubPrisma({ 1: CONFIGURED });
      const service = new TenantOAuthService(prisma);

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
      const service = new TenantOAuthService(prisma);
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
      const service = new TenantOAuthService(prisma);
      const logged = vi.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

      expect(await service.googleCredentials(1)).toBeNull();
      expect(logged).toHaveBeenCalledOnce();
    });

    it('does not log for a row with neither half set', async () => {
      const { prisma } = stubPrisma({ 1: {} });
      const service = new TenantOAuthService(prisma);
      const logged = vi.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

      await service.googleCredentials(1);
      expect(logged).not.toHaveBeenCalled();
    });
  });

  describe('facebookAppId', () => {
    it('is the community own app id, or null', async () => {
      const { prisma } = stubPrisma({ 1: CONFIGURED, 2: {} });
      const service = new TenantOAuthService(prisma);

      expect(await service.facebookAppId(1)).toBe('fb-id');
      expect(await service.facebookAppId(2)).toBeNull();
      expect(await service.facebookAppId(404)).toBeNull();
    });
  });
});

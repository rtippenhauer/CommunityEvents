import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, truncateAllTables } from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { TenantResolutionService } from '../src/common/tenant/tenant-resolution.service';
import { runWithTenant, runUnscoped } from '../src/common/tenant/tenant-store';
import { UserRole } from '../src/database/enums';
import { purgeTenantRows } from '../src/common/tenant/tenant-purge';

const TENANT_B_ID = 9047;
const TENANT_B_DOMAIN = 'other-avatars.example.test';

const inTenant = <T>(tenantId: number, fn: () => Promise<T>): Promise<T> =>
  runWithTenant(tenantId, async () => await fn());

/**
 * v2-47, asserted end to end: `avatar` and `merch_config` belong to a
 * community, not to the deployment.
 *
 * Both were the last entries in `GLOBAL_MODELS`' category (2), and both carried
 * a live cross-tenant write hole rather than only a design gap. What makes this
 * file worth having is the shape of that hole: an **id is globally unique**, so
 * `findUnique({ where: { id } })` matched one row whichever community it
 * belonged to and the scoping extension had nothing to narrow. A test that only
 * checks "my community sees my rows" passes against that bug -- every
 * assertion below that matters names a row belonging to somebody else.
 *
 * The v2-29 lesson applies directly. Two real defects shipped to stage because
 * neither event endpoint had a test; the scoping here is invisible from any
 * single-community run, which is precisely the condition under which the suite
 * cannot see it.
 */
describe('Avatars and merch are tenant-scoped (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenants: TenantResolutionService;
  let server: Parameters<typeof request>[0];

  let adminCookie: string;
  let memberCookie: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    server = app.getHttpServer();
    tenants = app.get(TenantResolutionService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    tenants.clearCache();

    const city = await seedCity(prisma);
    const admin = await seedUser(prisma, city.id, {
      role: UserRole.ADMIN,
      email: 'admin@example.test',
    });
    const member = await seedUser(prisma, city.id, {
      role: UserRole.MEMBER,
      email: 'member@example.test',
    });
    adminCookie = await loginAs(app, admin);
    memberCookie = await loginAs(app, member);
  });

  /** The other community, with rows of its own that must survive untouched. */
  async function seedOtherCommunity() {
    await prisma.tenants.create({
      data: { id: TENANT_B_ID, slug: 'other-avatars', domain: TENANT_B_DOMAIN },
    });
    const theirAvatar = await inTenant(TENANT_B_ID, () =>
      prisma.avatar.create({
        data: { path: '/avatars/bear-wizard.png', label: 'Their Wizard' },
      }),
    );
    const theirMerch = await inTenant(TENANT_B_ID, () =>
      prisma.merch_config.create({
        data: { storeUrl: 'https://theirs.example.test/shop' },
      }),
    );
    return { theirAvatar, theirMerch };
  }

  describe('the picker shows one community its own rows', () => {
    it('does not serve another community presets', async () => {
      await seedOtherCommunity();
      await prisma.avatar.create({
        data: { path: '/avatars/bear-chef.jpg', label: 'Our Chef' },
      });

      const res = await request(server)
        .get('/api/v1/avatars/manifest')
        .set('Cookie', memberCookie)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].label).toBe('Our Chef');
    });

    /**
     * `path` was globally unique (`uq_avatar_path`) until v2-47, so the second
     * community to want a file that ships in the frontend image could not have
     * it -- the first one to be created or imported took it out of everybody
     * else's reach, for a file belonging to none of them.
     */
    it('lets two communities both carry the same shipped file', async () => {
      await seedOtherCommunity();

      await expect(
        prisma.avatar.create({
          data: { path: '/avatars/bear-wizard.png', label: 'Our Wizard' },
        }),
      ).resolves.toMatchObject({ label: 'Our Wizard' });
    });

    it('still refuses the same path twice within one community', async () => {
      await prisma.avatar.create({
        data: { path: '/avatars/bear-chef.jpg', label: 'Chef' },
      });

      await expect(
        prisma.avatar.create({
          data: { path: '/avatars/bear-chef.jpg', label: 'Chef again' },
        }),
      ).rejects.toThrow();
    });
  });

  /**
   * The security half of v2-47, and the only part that is a fix rather than a
   * data-ownership change. `AvatarsService` read and wrote by primary key, and
   * a primary key is unique across the whole deployment.
   */
  describe('an admin cannot reach another community rows by id', () => {
    it('404s on renaming somebody else preset, and leaves it alone', async () => {
      const { theirAvatar } = await seedOtherCommunity();

      await request(server)
        .patch(`/api/v1/admin/avatars/${theirAvatar.id}`)
        .set('Cookie', adminCookie)
        .send({ label: 'Mine now' })
        .expect(404);

      const after = await inTenant(TENANT_B_ID, () =>
        prisma.avatar.findFirst({ where: { id: theirAvatar.id } }),
      );
      expect(after!.label).toBe('Their Wizard');
    });

    it('404s on deleting somebody else preset, and leaves it alone', async () => {
      const { theirAvatar } = await seedOtherCommunity();

      await request(server)
        .delete(`/api/v1/admin/avatars/${theirAvatar.id}`)
        .set('Cookie', adminCookie)
        .expect(404);

      const after = await inTenant(TENANT_B_ID, () =>
        prisma.avatar.findFirst({ where: { id: theirAvatar.id } }),
      );
      expect(after).not.toBeNull();
    });

    it('does not list another community presets in the admin screen', async () => {
      await seedOtherCommunity();

      const res = await request(server)
        .get('/api/v1/admin/avatars')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body).toHaveLength(0);
    });
  });

  /**
   * A member picks a preset by **path**, and `setAvatar` checks that path
   * against the `avatar` table. Scoped, that check stops being satisfiable by
   * another community's row -- otherwise pasting a known path would let a
   * member wear a preset their community never offered.
   */
  describe('setAvatar is bounded by the community own list', () => {
    it('refuses a path that exists only in another community', async () => {
      await seedOtherCommunity();

      await request(server)
        .post('/api/v1/users/me/avatar')
        .set('Cookie', memberCookie)
        .send({ avatarPath: '/avatars/bear-wizard.png' })
        .expect(400);
    });
  });

  /**
   * `merch_config` was a singleton pinned to id 1, so every community read the
   * same row: `store_url` and `founding_bear_product_url` pointed all of them
   * at DinnerBears' shop, and any community's admin could repoint it for the
   * rest.
   */
  describe('merch config is one row per community', () => {
    it('does not serve another community store link', async () => {
      await seedOtherCommunity();
      await prisma.merch_config.create({
        data: { storeUrl: 'https://ours.example.test/shop' },
      });

      const res = await request(server)
        .get('/api/v1/merch/admin/config')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.storeUrl).toBe('https://ours.example.test/shop');
    });

    it('writes only its own row', async () => {
      const { theirMerch } = await seedOtherCommunity();
      await prisma.merch_config.create({
        data: { storeUrl: 'https://ours.example.test/shop' },
      });

      await request(server)
        .patch('/api/v1/merch/admin/config')
        .set('Cookie', adminCookie)
        .send({ storeUrl: 'https://ours.example.test/new' })
        .expect(200);

      const after = await inTenant(TENANT_B_ID, () =>
        prisma.merch_config.findFirst({ where: { id: theirMerch.id } }),
      );
      expect(after!.storeUrl).toBe('https://theirs.example.test/shop');
    });

    it('refuses a second row for the same community', async () => {
      await prisma.merch_config.create({ data: {} });

      await expect(
        prisma.merch_config.create({ data: {} }),
      ).rejects.toThrow();
    });
  });

  /**
   * Deleting a community has to keep working. `tenant_id` is RESTRICT on both
   * new foreign keys, so one surviving row aborts the whole transaction, and
   * the purge walks `TENANT_SCOPED_MODELS` -- which means classifying these
   * two is what covers them. Asserted rather than assumed, because the failure
   * only appears against a community that actually holds rows, and nothing had
   * deleted a populated community until v2-14 went looking.
   */
  describe('the purge covers both new tables', () => {
    it('erases a community presets and store link, and nobody else', async () => {
      await seedOtherCommunity();
      const ourAvatar = await prisma.avatar.create({
        data: { path: '/avatars/bear-chef.jpg', label: 'Our Chef' },
      });
      await prisma.merch_config.create({ data: { storeUrl: 'https://ours.example.test/shop' } });

      // `runUnscoped`, exactly as `TenantsAdminService.remove` does: the purge
      // writes an explicit `tenantId` filter, and the extension refuses a query
      // filtered to one tenant while another is in context -- which is the
      // guard doing its job, since the spec worker's ambient tenant is 1.
      const deleted = await runUnscoped('purging the other community in a spec', () =>
        prisma.$transaction((tx) => purgeTenantRows(tx, TENANT_B_ID), { timeout: 20_000 }),
      );

      expect(deleted.avatar).toBe(1);
      expect(deleted.merch_config).toBe(1);

      const theirs = await inTenant(TENANT_B_ID, async () => ({
        avatars: await prisma.avatar.count(),
        merch: await prisma.merch_config.count(),
      }));
      expect(theirs.avatars).toBe(0);
      expect(theirs.merch).toBe(0);

      // Ours is untouched, which is the half a `deleteMany({})` that lost its
      // filter would fail.
      expect(await prisma.avatar.findFirst({ where: { id: ourAvatar.id } })).not.toBeNull();
      expect(await prisma.merch_config.count()).toBe(1);
    });

    /** And the `tenants` row itself then deletes, with no RESTRICT left. */
    it('lets the tenant row go once its rows are purged', async () => {
      await seedOtherCommunity();

      await runUnscoped('purging the other community in a spec', () =>
        prisma.$transaction((tx) => purgeTenantRows(tx, TENANT_B_ID), { timeout: 20_000 }),
      );

      await expect(prisma.tenants.delete({ where: { id: TENANT_B_ID } })).resolves.toMatchObject({
        id: TENANT_B_ID,
      });
    });
  });
});

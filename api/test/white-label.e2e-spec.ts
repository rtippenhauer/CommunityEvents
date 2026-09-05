import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestApp,
  resetThrottler,
  truncateAllTables,
  TEST_TENANT_DOMAIN,
} from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import type { avatar as Avatar, cities as City, users as User } from '@prisma/client';
import { UserRole } from '../src/database/enums';

// Phase 31 (runtime white-label): the generic image resolves per-instance
// branding/avatars at runtime. These cover the two new server surfaces:
// /config/branding surfacing env-derived values, and the admin-managed avatar
// set (+ the tightened setAvatar validation that backs it).
describe('White-label runtime config (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];

  let city: City;
  let admin: User;
  let adminCookie: string;
  let member: User;
  let memberCookie: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    resetThrottler(app);
    city = await seedCity(prisma);
    admin = await seedUser(prisma, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    member = await seedUser(prisma, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
    adminCookie = await loginAs(app, admin);
    memberCookie = await loginAs(app, member);
  });

  async function seedAvatar(path: string, label: string): Promise<Avatar> {
    return prisma.avatar.create({ data: { path, label } });
  }

  // The brand-image slots had no coverage at all before v2-10 added the fifth
  // one. These exercise the wiring a new slot needs -- servable key, default,
  // branding payload field, and registration in BRAND_IMAGE_SLOTS -- rather
  // than the multipart upload itself, which would write to disk.
  describe('Error page backdrop slot (v2-10)', () => {
    it('is absent by default, so the page falls back to the brand colours', async () => {
      const res = await request(server).get('/api/v1/config/branding').expect(200);
      // Present as a key but empty: the frontend distinguishes "nothing
      // uploaded" (draw the gradient) from "not served at all".
      expect(res.body).toHaveProperty('errorUrl');
      expect(res.body.errorUrl).toBe('');
    });

    it('surfaces an uploaded backdrop to unauthenticated visitors', async () => {
      // Error pages render before sign-in, so this must be public.
      await request(server)
        .patch('/api/v1/admin/config/brand_error_url')
        .set('Cookie', adminCookie)
        .send({ value: '/api/uploads/branding/backdrop.png' })
        .expect(200);

      const res = await request(server).get('/api/v1/config/branding').expect(200);
      expect(res.body.errorUrl).toBe('/api/uploads/branding/backdrop.png');
      // Ordering guard: the payload builds errorUrl and iconUrl from a
      // positional Promise.all, so a misaligned insert swaps them silently.
      expect(res.body.iconUrl).toBe('');
    });

    it('registers "error" as a brand image slot that can be cleared', async () => {
      await request(server)
        .patch('/api/v1/admin/config/brand_error_url')
        .set('Cookie', adminCookie)
        .send({ value: '/api/uploads/branding/backdrop.png' })
        .expect(200);

      // An unregistered slot 400s here, so this is what proves the slot exists.
      await request(server)
        .patch('/api/v1/admin/config/branding/image/error/reset')
        .set('Cookie', adminCookie)
        .expect(200);

      const res = await request(server).get('/api/v1/config/branding').expect(200);
      expect(res.body.errorUrl).toBe('');
    });

    it('rejects an unknown slot', async () => {
      await request(server)
        .patch('/api/v1/admin/config/branding/image/nonsense/reset')
        .set('Cookie', adminCookie)
        .expect(400);
    });
  });

  describe('GET /config/branding', () => {
    it('is public and surfaces the env-derived per-instance values', async () => {
      const res = await request(server).get('/api/v1/config/branding').expect(200);
      // `appUrl` is the *requesting tenant's* canonical URL as of v2-6, not the
      // deployment's APP_URL. Every other field in this payload is per-tenant
      // (app_config is scoped now), so a deployment-global value here would have
      // been the one field describing somebody else's community. The scheme
      // still comes from APP_URL, since TLS is a property of the deployment.
      expect(res.body.appUrl).toBe(`http://${TEST_TENANT_DOMAIN}`);
      // Still env-derived: this is the mail domain, not the cookie or link scope.
      expect(res.body.baseDomain).toBe('localhost');
      // Unset in the test env → the graceful "feature off" defaults.
      expect(res.body.isStage).toBe(false);
      expect(res.body.vapidPublicKey).toBeNull();
      expect(res.body.facebookAppId).toBeNull();
      // DB-backed branding falls back to the seeded DinnerBears defaults.
      expect(res.body.colorPrimary).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(typeof res.body.name).toBe('string');
    });
  });

  describe('Avatars', () => {
    it('serves the manifest publicly (no auth)', async () => {
      await seedAvatar('/avatars/bear-chef.jpg', 'Chef');
      const res = await request(server).get('/api/v1/avatars/manifest').expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ path: '/avatars/bear-chef.jpg', label: 'Chef' });
    });

    it('lets an admin add a label/rename and delete an avatar', async () => {
      const avatar = await seedAvatar('/api/uploads/avatars/x.png', 'Old');

      await request(server)
        .patch(`/api/v1/admin/avatars/${avatar.id}`)
        .set('Cookie', adminCookie)
        .send({ label: 'New' })
        .expect(200);

      await request(server)
        .delete(`/api/v1/admin/avatars/${avatar.id}`)
        .set('Cookie', adminCookie)
        .expect(200);

      const res = await request(server).get('/api/v1/avatars/manifest').expect(200);
      expect(res.body).toHaveLength(0);
    });

    it('forbids non-admins from managing avatars', async () => {
      const avatar = await seedAvatar('/avatars/bear-chef.jpg', 'Chef');
      await request(server)
        .delete(`/api/v1/admin/avatars/${avatar.id}`)
        .set('Cookie', memberCookie)
        .expect(403);
      await request(server).post('/api/v1/admin/avatars').set('Cookie', memberCookie).expect(403);
    });
  });

  describe('POST /users/me/avatar', () => {
    it('accepts a path that is one of this instance\'s avatars', async () => {
      await seedAvatar('/avatars/bear-chef.jpg', 'Chef');
      const res = await request(server)
        .post('/api/v1/users/me/avatar')
        .set('Cookie', memberCookie)
        .send({ avatarPath: '/avatars/bear-chef.jpg' })
        .expect(201);
      expect(res.body.url).toBe('/avatars/bear-chef.jpg');
    });

    it('rejects a well-formed but non-existent avatar path', async () => {
      // Passes the DTO format regex but is not in the avatar table.
      await request(server)
        .post('/api/v1/users/me/avatar')
        .set('Cookie', memberCookie)
        .send({ avatarPath: '/avatars/not-a-real-avatar.png' })
        .expect(400);
    });

    it('rejects a malformed avatar path at the DTO layer', async () => {
      await request(server)
        .post('/api/v1/users/me/avatar')
        .set('Cookie', memberCookie)
        .send({ avatarPath: 'https://evil.example/x.png' })
        .expect(400);
    });
  });
});

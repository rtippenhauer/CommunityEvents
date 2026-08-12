import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, truncateAllTables } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import type { achievements as Achievement, cities as City, location_photos as LocationPhoto, locations as Location, users as User } from '@prisma/client';
import { UserRole } from '../src/database/enums';

// 1x1 transparent PNG, valid enough to pass the mimetype/extension filter —
// no image-processing library exists anywhere in this codebase, so filters
// only ever check mimetype + extension, never real image content.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('Uploads (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];

  let city: City;
  let location: Location;
  let adminCookie: string;
  let moderatorCookie: string;
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
    city = await seedCity(prisma);
    location = await seedLocation(prisma, city.id);

    const admin = await seedUser(prisma, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    const moderator = await seedUser(prisma, city.id, { role: UserRole.MODERATOR, email: 'mod@example.test' });
    member = await seedUser(prisma, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
    adminCookie = await loginAs(app, admin);
    moderatorCookie = await loginAs(app, moderator);
    memberCookie = await loginAs(app, member);

    // setAvatar checks the requested path against this instance's `avatar`
    // catalog, which is reference data seeded once per install (prisma/seed.ts)
    // and wiped by truncateAllTables like everything else. Seed just the row
    // the preset-avatar test selects, the same way the gamification spec
    // re-seeds the achievement keys it exercises.
    await prisma.avatar.create({
      data: { path: '/avatars/bear-grizzly.png', label: 'Grizzly', sortOrder: 0 },
    });
  });

  describe('POST /users/me/photo + GET /uploads/profiles/:filename (auth-gated serving)', () => {
    it('uploads a profile photo and updates the profile photo path', async () => {
      const res = await request(server)
        .post('/api/v1/users/me/photo')
        .set('Cookie', memberCookie)
        .attach('photo', TINY_PNG, 'me.png')
        .expect(201);

      expect(res.body.url).toMatch(/^\/api\/v1\/uploads\/profiles\/.+\.png$/);

      const updated = await prisma.users.findFirst({ where: { id: member.id } });
      expect(updated!.profilePhotoPath).toBe(res.body.url);
    });

    it('serves the uploaded photo to an authenticated caller', async () => {
      const uploaded = await request(server)
        .post('/api/v1/users/me/photo')
        .set('Cookie', memberCookie)
        .attach('photo', TINY_PNG, 'me.png')
        .expect(201);
      const filename = uploaded.body.url.split('/').pop();

      await request(server).get(`/api/v1/uploads/profiles/${filename}`).set('Cookie', memberCookie).expect(200);
    });

    it('rejects fetching a profile photo without authentication', async () => {
      const uploaded = await request(server)
        .post('/api/v1/users/me/photo')
        .set('Cookie', memberCookie)
        .attach('photo', TINY_PNG, 'me.png')
        .expect(201);
      const filename = uploaded.body.url.split('/').pop();

      await request(server).get(`/api/v1/uploads/profiles/${filename}`).expect(401);
    });

    it('returns 404 for a nonexistent profile photo filename', async () => {
      await request(server).get('/api/v1/uploads/profiles/nonexistent-file.png').set('Cookie', memberCookie).expect(404);
    });

    it('rejects a disallowed file type', async () => {
      await request(server)
        .post('/api/v1/users/me/photo')
        .set('Cookie', memberCookie)
        .attach('photo', Buffer.from('not an image'), 'notes.txt')
        .expect(500);
    });

    it('rejects unauthenticated uploads', async () => {
      await request(server).post('/api/v1/users/me/photo').attach('photo', TINY_PNG, 'me.png').expect(401);
    });
  });

  describe('POST /users/me/avatar (preset avatar selection, no upload)', () => {
    it('sets a preset avatar path', async () => {
      const res = await request(server)
        .post('/api/v1/users/me/avatar')
        .set('Cookie', memberCookie)
        .send({ avatarPath: '/avatars/bear-grizzly.png' })
        .expect(201);
      expect(res.body.url).toBe('/avatars/bear-grizzly.png');

      const updated = await prisma.users.findFirst({ where: { id: member.id } });
      expect(updated!.profilePhotoPath).toBe('/avatars/bear-grizzly.png');
    });

    it('rejects a path outside the avatars directory pattern', async () => {
      await request(server)
        .post('/api/v1/users/me/avatar')
        .set('Cookie', memberCookie)
        .send({ avatarPath: '/etc/passwd' })
        .expect(400);
    });
  });

  describe('POST /locations/:id/photos + DELETE /locations/:id/photos/:photoId', () => {
    it('adds a photo as admin', async () => {
      const res = await request(server)
        .post(`/api/v1/locations/${location.id}/photos`)
        .set('Cookie', adminCookie)
        .attach('photo', TINY_PNG, 'location.png')
        .expect(201);

      expect(res.body.filePath).toMatch(/^\/api\/uploads\/locations\/.+\.png$/);
      expect(res.body.locationId).toBe(location.id);
    });

    it('adds a photo as moderator', async () => {
      await request(server)
        .post(`/api/v1/locations/${location.id}/photos`)
        .set('Cookie', moderatorCookie)
        .attach('photo', TINY_PNG, 'location.png')
        .expect(201);
    });

    it('assigns increasing sort order across multiple photos', async () => {
      const first = await request(server)
        .post(`/api/v1/locations/${location.id}/photos`)
        .set('Cookie', adminCookie)
        .attach('photo', TINY_PNG, 'first.png')
        .expect(201);
      const second = await request(server)
        .post(`/api/v1/locations/${location.id}/photos`)
        .set('Cookie', adminCookie)
        .attach('photo', TINY_PNG, 'second.png')
        .expect(201);

      expect(second.body.sortOrder).toBe(first.body.sortOrder + 1);
    });

    it('rejects a member adding a photo (mod/admin only)', async () => {
      await request(server)
        .post(`/api/v1/locations/${location.id}/photos`)
        .set('Cookie', memberCookie)
        .attach('photo', TINY_PNG, 'location.png')
        .expect(403);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).post(`/api/v1/locations/${location.id}/photos`).attach('photo', TINY_PNG, 'location.png').expect(401);
    });

    it('deletes a photo as admin', async () => {
      const created = await request(server)
        .post(`/api/v1/locations/${location.id}/photos`)
        .set('Cookie', adminCookie)
        .attach('photo', TINY_PNG, 'location.png')
        .expect(201);

      await request(server)
        .delete(`/api/v1/locations/${location.id}/photos/${created.body.id}`)
        .set('Cookie', adminCookie)
        .expect(200);

      const remaining = await prisma.location_photos.findFirst({ where: { id: created.body.id } });
      expect(remaining).toBeNull();
    });

    it('rejects a member deleting a photo (mod/admin only)', async () => {
      const created = await request(server)
        .post(`/api/v1/locations/${location.id}/photos`)
        .set('Cookie', adminCookie)
        .attach('photo', TINY_PNG, 'location.png')
        .expect(201);

      await request(server)
        .delete(`/api/v1/locations/${location.id}/photos/${created.body.id}`)
        .set('Cookie', memberCookie)
        .expect(403);
    });
  });

  describe('POST /admin/achievements/:id/image', () => {
    async function seedAchievement(): Promise<Achievement> {
      return prisma.achievements.create({ data: {
        key: `upload-test-${Date.now()}`,
        name: 'Upload Test Achievement',
        description: 'd',
      } });
    }

    it('uploads an achievement image as admin', async () => {
      const achievement = await seedAchievement();

      const res = await request(server)
        .post(`/api/v1/admin/achievements/${achievement.id}/image`)
        .set('Cookie', adminCookie)
        .attach('image', TINY_PNG, 'achievement.png')
        .expect(201);

      expect(res.body.imagePath).toMatch(/^\/api\/uploads\/achievements\/.+\.png$/);
      const updated = await prisma.achievements.findFirst({ where: { id: achievement.id } });
      expect(updated!.imagePath).toBe(res.body.imagePath);
    });

    it('rejects a request with no image file', async () => {
      const achievement = await seedAchievement();
      await request(server).post(`/api/v1/admin/achievements/${achievement.id}/image`).set('Cookie', adminCookie).expect(400);
    });

    it('rejects a moderator uploading an achievement image (admin-only)', async () => {
      const achievement = await seedAchievement();
      await request(server)
        .post(`/api/v1/admin/achievements/${achievement.id}/image`)
        .set('Cookie', moderatorCookie)
        .attach('image', TINY_PNG, 'achievement.png')
        .expect(403);
    });
  });

  describe('POST /admin/custom-icons/:id/reprocess', () => {
    it('reprocesses an icon to a new path and repoints referencing achievements', async () => {
      const created = await request(server)
        .post('/api/v1/admin/custom-icons')
        .set('Cookie', adminCookie)
        .field('name', 'Reprocess Me')
        .attach('image', TINY_PNG, 'original.png')
        .expect(201);

      const achievement = await prisma.achievements.create({ data: {
        key: `reprocess-linked-${Date.now()}`,
        name: 'Linked Achievement',
        description: 'd',
        icon: `img:${created.body.imagePath}`,
      } });

      const reprocessed = await request(server)
        .post(`/api/v1/admin/custom-icons/${created.body.id}/reprocess`)
        .set('Cookie', adminCookie)
        .attach('image', TINY_PNG, 'reprocessed.png')
        .expect(201);

      expect(reprocessed.body.imagePath).not.toBe(created.body.imagePath);

      const updatedAchievement = await prisma.achievements.findFirst({ where: { id: achievement.id } });
      expect(updatedAchievement!.icon).toBe(`img:${reprocessed.body.imagePath}`);
    });

    it('returns 404 for a nonexistent icon', async () => {
      await request(server)
        .post('/api/v1/admin/custom-icons/999999/reprocess')
        .set('Cookie', adminCookie)
        .attach('image', TINY_PNG, 'reprocessed.png')
        .expect(404);
    });

    it('rejects a request with no image file', async () => {
      const created = await request(server)
        .post('/api/v1/admin/custom-icons')
        .set('Cookie', adminCookie)
        .field('name', 'No Reprocess Image')
        .attach('image', TINY_PNG, 'original.png')
        .expect(201);

      await request(server).post(`/api/v1/admin/custom-icons/${created.body.id}/reprocess`).set('Cookie', adminCookie).expect(400);
    });

    it('rejects a member reprocessing an icon (mod/admin only)', async () => {
      const created = await request(server)
        .post('/api/v1/admin/custom-icons')
        .set('Cookie', adminCookie)
        .field('name', 'Member Blocked')
        .attach('image', TINY_PNG, 'original.png')
        .expect(201);

      await request(server)
        .post(`/api/v1/admin/custom-icons/${created.body.id}/reprocess`)
        .set('Cookie', memberCookie)
        .attach('image', TINY_PNG, 'reprocessed.png')
        .expect(403);
    });
  });
});

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import type { cities as City, users as User } from '@prisma/client';
import { UserRole } from '../src/database/enums';

// A community's Terms and Privacy Policy: seeded from platform templates so the
// public pages are never blank, substituted on read so a rename does not strand
// the old name in them, and restorable when a community has neither.
describe('legal copy (e2e)', () => {
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

  const restore = () =>
    request(server).post('/api/v1/admin/config/legal/restore-defaults').set('Cookie', adminCookie);

  it('fills the community name into what a visitor reads', async () => {
    // The templates are stored with placeholders and substituted on the public
    // read. A visitor must never see one -- and the admin editor must always
    // see them, or saving would freeze today's name in as literal text.
    await restore().expect(201);
    await request(server)
      .patch('/api/v1/admin/config/brand_name')
      .set('Cookie', adminCookie)
      .send({ value: 'Dayton Community Events' })
      .expect(200);

    const publicRead = await request(server)
      .get('/api/v1/config/legal_terms_html')
      .expect(200);

    expect(publicRead.body.value).toContain('Dayton Community Events');
    expect(publicRead.body.value).not.toContain('{{');

    const adminRead = await request(server)
      .get('/api/v1/admin/config/legal')
      .set('Cookie', adminCookie)
      .expect(200);
    const terms = adminRead.body.find(
      (r: { configKey: string }) => r.configKey === 'legal_terms_html',
    );
    expect(terms.configValue).toContain('{{brand_name}}');
  });

  it('follows a rename rather than keeping the old name', async () => {
    await restore().expect(201);
    for (const value of ['First Name', 'Second Name']) {
      await request(server)
        .patch('/api/v1/admin/config/brand_name')
        .set('Cookie', adminCookie)
        .send({ value })
        .expect(200);
    }

    const publicRead = await request(server).get('/api/v1/config/legal_privacy_html').expect(200);

    expect(publicRead.body.value).toContain('Second Name');
    expect(publicRead.body.value).not.toContain('First Name');
  });

  it('restores the starter copy over an edit, and un-confirms it', async () => {
    await request(server)
      .patch('/api/v1/admin/config/legal_terms_html')
      .set('Cookie', adminCookie)
      .send({ value: '<p>Our own terms.</p>' })
      .expect(200);
    await request(server)
      .patch('/api/v1/admin/config/legal_reviewed_at')
      .set('Cookie', adminCookie)
      .send({ value: new Date().toISOString() })
      .expect(200);

    const res = await restore().expect(201);

    const terms = res.body.find((r: { configKey: string }) => r.configKey === 'legal_terms_html');
    expect(terms.configValue).not.toContain('Our own terms.');
    expect(terms.configValue).toContain('{{legal_entity}}');

    // Restoring is the opposite of reviewing: the copy is now something nobody
    // has read, so the banner has to come back.
    const settings = await request(server)
      .get('/api/v1/admin/config/site-settings')
      .set('Cookie', adminCookie)
      .expect(200);
    const reviewed = settings.body.find(
      (s: { configKey: string }) => s.configKey === 'legal_reviewed_at',
    );
    expect(reviewed.configValue).toBe('');
  });

  it('is admin-only', async () => {
    await request(server)
      .post('/api/v1/admin/config/legal/restore-defaults')
      .set('Cookie', memberCookie)
      .expect(403);

    await request(server).post('/api/v1/admin/config/legal/restore-defaults').expect(401);
  });
});

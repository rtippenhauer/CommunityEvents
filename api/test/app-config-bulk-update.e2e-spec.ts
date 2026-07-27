import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { CityEntity } from '../src/database/entities/city.entity';
import { UserEntity, UserRole } from '../src/database/entities/user.entity';

// Bug fix (found live on stage after Phase 33): /admin/settings' Save button
// used to fire one PATCH /admin/config/:key per field (19 as of the Phase 33
// feature-toggle additions), which could trip the global write-rate-limit
// (30 writes/60s/IP, see ThrottlerAuditGuard) on a double-click or retry —
// symptom was a wall of 429s and some fields silently not saving. The fix is
// a single bulk endpoint the settings form now calls instead.
describe('PATCH /admin/config/bulk (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: Parameters<typeof request>[0];

  let city: CityEntity;
  let admin: UserEntity;
  let adminCookie: string;
  let member: UserEntity;
  let memberCookie: string;

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    resetThrottler(app);
    city = await seedCity(dataSource);
    admin = await seedUser(dataSource, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    member = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
    adminCookie = await loginAs(app, admin);
    memberCookie = await loginAs(app, member);
  });

  it('saves many keys in a single request as an admin', async () => {
    await request(server)
      .patch('/api/v1/admin/config/bulk')
      .set('Cookie', adminCookie)
      .send({
        entries: [
          { key: 'brand_name', value: 'Test Brand' },
          { key: 'feature_merch', value: 'false' },
          { key: 'feature_ratings', value: 'false' },
        ],
      })
      .expect(200);

    const settings = await request(server)
      .get('/api/v1/admin/config/site-settings')
      .set('Cookie', adminCookie)
      .expect(200);

    const byKey = Object.fromEntries(
      settings.body.map((s: { configKey: string; configValue: string }) => [s.configKey, s.configValue]),
    );
    expect(byKey.brand_name).toBe('Test Brand');
    expect(byKey.feature_merch).toBe('false');
    expect(byKey.feature_ratings).toBe('false');
  });

  it('does the equivalent of a full settings-form save in one request, well under the write rate limit', async () => {
    // Mirrors the exact 19-field payload admin-settings.component.ts sends —
    // this is the regression the bulk endpoint exists to fix. A single
    // request can never trip a 30-writes/60s limit no matter how many keys
    // it carries.
    const entries = [
      { key: 'brand_name', value: 'DinnerBears' },
      { key: 'brand_tagline', value: 'Good food.' },
      { key: 'theme_color_primary', value: '#C9933A' },
      { key: 'theme_color_accent', value: '#C9933A' },
      { key: 'theme_color_background', value: '#FDFAF5' },
      { key: 'location_privacy_default', value: 'public' },
      { key: 'event_cadence_weekday', value: '2' },
      { key: 'event_cadence_time', value: '18:30' },
      { key: 'home_show_stats', value: 'true' },
      { key: 'term_location_singular', value: 'Restaurant' },
      { key: 'term_location_plural', value: 'Restaurants' },
      { key: 'term_dinner_singular', value: 'Dinner' },
      { key: 'term_dinner_plural', value: 'Dinners' },
      { key: 'term_points', value: 'Bear Points' },
      { key: 'feature_ratings', value: 'true' },
      { key: 'feature_ratings_residences', value: 'true' },
      { key: 'feature_leaderboard', value: 'true' },
      { key: 'feature_merch', value: 'true' },
      { key: 'feature_members', value: 'true' },
    ];

    // Fire it twice back-to-back (the double-click / retry scenario that
    // used to 429 under the old one-PATCH-per-key approach).
    await request(server).patch('/api/v1/admin/config/bulk').set('Cookie', adminCookie).send({ entries }).expect(200);
    await request(server).patch('/api/v1/admin/config/bulk').set('Cookie', adminCookie).send({ entries }).expect(200);
  });

  it('rejects an unknown config key without partially applying the batch', async () => {
    await request(server)
      .patch('/api/v1/admin/config/bulk')
      .set('Cookie', adminCookie)
      .send({
        entries: [
          { key: 'brand_name', value: 'Should Not Persist' },
          { key: 'not_a_real_key', value: 'x' },
        ],
      })
      .expect(404);

    const settings = await request(server)
      .get('/api/v1/admin/config/site-settings')
      .set('Cookie', adminCookie)
      .expect(200);
    const brandName = settings.body.find((s: { configKey: string }) => s.configKey === 'brand_name');
    expect(brandName.configValue).toBe('DinnerBears');
  });

  it('rejects requests from a non-admin member', async () => {
    await request(server)
      .patch('/api/v1/admin/config/bulk')
      .set('Cookie', memberCookie)
      .send({ entries: [{ key: 'brand_name', value: 'Hacked' }] })
      .expect(403);
  });

  it('rejects unauthenticated requests', async () => {
    await request(server)
      .patch('/api/v1/admin/config/bulk')
      .send({ entries: [{ key: 'brand_name', value: 'Hacked' }] })
      .expect(401);
  });
});

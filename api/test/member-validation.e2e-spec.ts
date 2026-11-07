import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestApp,
  truncateAllTables,
  resetThrottler,
  TEST_TENANT_DOMAIN,
} from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { runWithTenant } from '../src/common/tenant/tenant-store';
import { UserRole } from '../src/database/enums';
import { TEST_TENANT_ID } from './setup-env';
import type { cities as City, users as User } from '@prisma/client';

const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithTenant(TEST_TENANT_ID, async () => await fn());

/**
 * Vouching a non-validated member up to full membership.
 *
 * A `non_validated` account is what redeeming an event invite of that flavour
 * produces -- links posted publicly in a Facebook group, so a stranger who
 * redeems one still needs a human to approve them. The approval is the Vouch
 * button on Admin -> Users, and `PATCH /users/:id/validate` behind it.
 *
 * Untested until now, which is the same gap v2-29 found on the Muse routes:
 * the capability is only as good as the weakest gate in front of it, and three
 * separate things have to agree for a moderator to use it -- the Angular route
 * guard, the list endpoint and the validate endpoint. Widening one and leaving
 * another is exactly how the Facebook queue reached stage admin-only.
 */
describe('Member validation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let city: City;
  let moderatorCookie: string;
  let memberCookie: string;
  let pending: User;

  beforeAll(async () => {
    const created = await createTestApp();
    app = created.app;
    prisma = created.prisma;
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    resetThrottler(app);

    city = await seedCity(prisma);

    const moderator = await seedUser(prisma, city.id, {
      role: UserRole.MODERATOR,
      email: 'mod@example.test',
    });
    moderatorCookie = await inTenant(() => loginAs(app, moderator));

    const member = await seedUser(prisma, city.id, {
      role: UserRole.MEMBER,
      email: 'plain@example.test',
    });
    memberCookie = await inTenant(() => loginAs(app, member));

    pending = await seedUser(prisma, city.id, {
      role: UserRole.NON_VALIDATED,
      email: 'pending@example.test',
    });
  });

  // The list is how the Vouch button is reached at all. A moderator who cannot
  // read it has no row to press, so the validate gate below never comes up --
  // and the screen reads as "nobody is waiting" rather than as a refusal.
  it('lets a moderator see the pending member in the admin list', async () => {
    const res = await request(server)
      .get('/api/v1/admin/users')
      .set('Host', TEST_TENANT_DOMAIN)
      .set('Cookie', moderatorCookie)
      .expect(200);

    const row = res.body.find((u: { id: number }) => u.id === pending.id);
    expect(row).toBeDefined();
    expect(row.role).toBe(UserRole.NON_VALIDATED);
  });

  it('lets a moderator vouch, and the promotion is really written', async () => {
    await request(server)
      .patch(`/api/v1/users/${pending.id}/validate`)
      .set('Host', TEST_TENANT_DOMAIN)
      .set('Cookie', moderatorCookie)
      .expect(200);

    const after = await inTenant(() =>
      prisma.users.findUnique({ where: { id: pending.id } }),
    );
    expect(after?.role).toBe(UserRole.MEMBER);
  });

  // Vouching is the whole trust boundary on a publicly-posted invite link. A
  // member who could vouch could promote themselves a friend, which makes the
  // non_validated flavour decorative.
  it('refuses a plain member', async () => {
    await request(server)
      .patch(`/api/v1/users/${pending.id}/validate`)
      .set('Host', TEST_TENANT_DOMAIN)
      .set('Cookie', memberCookie)
      .expect(403);

    const after = await inTenant(() =>
      prisma.users.findUnique({ where: { id: pending.id } }),
    );
    expect(after?.role).toBe(UserRole.NON_VALIDATED);
  });

  it('refuses an anonymous caller', async () => {
    await request(server)
      .patch(`/api/v1/users/${pending.id}/validate`)
      .set('Host', TEST_TENANT_DOMAIN)
      .expect(401);
  });

  // Not an error, and deliberately so: two moderators looking at the same
  // queue both press Vouch, and the second must not 400 at somebody who did
  // nothing wrong. What matters is that it does not *demote* an admin who is
  // already past this point.
  it('is a no-op on somebody already validated, and never demotes them', async () => {
    const admin = await seedUser(prisma, city.id, {
      role: UserRole.ADMIN,
      email: 'already@example.test',
    });

    await request(server)
      .patch(`/api/v1/users/${admin.id}/validate`)
      .set('Host', TEST_TENANT_DOMAIN)
      .set('Cookie', moderatorCookie)
      .expect(200);

    const after = await inTenant(() => prisma.users.findUnique({ where: { id: admin.id } }));
    expect(after?.role).toBe(UserRole.ADMIN);
  });
});

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, truncateAllTables } from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { UserRole, FeedbackStatus } from '../src/database/enums';
import { runUnscoped } from '../src/common/tenant/tenant-store';

/**
 * Linking bugs & requests to a release (v2-43).
 *
 * Before this, `system_reports.shipped_in_release_id` could only be set by
 * typing a version into the triage PATCH, and no screen did -- so v2-32's
 * "credit is a link" was unreachable by a human: marking a report Shipped set
 * a status and created no link, and the release composer offered only
 * tenant-scoped `feedback`, which is a different board.
 */
describe('Release ↔ report links (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let operatorCookie: string;
  let adminCookie: string;
  let reporterId: number;

  const unscoped = <T>(fn: () => Promise<T>): Promise<T> =>
    runUnscoped('test fixture', fn);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    const city = await seedCity(prisma);
    const operator = await seedUser(prisma, city.id, {
      role: UserRole.SYSTEM_ADMIN,
      email: 'operator@example.test',
    });
    const admin = await seedUser(prisma, city.id, {
      role: UserRole.ADMIN,
      email: 'admin@example.test',
    });
    operatorCookie = await loginAs(app, operator);
    adminCookie = await loginAs(app, admin);
    reporterId = admin.id;
  });

  const makeRelease = async (version: string, body = 'The note, written by hand.') =>
    await unscoped(async () =>
      prisma.releases.create({
        data: { version, title: `Release ${version}`, body, createdBy: reporterId },
      }),
    );

  const makeReport = async (title: string, status: FeedbackStatus) =>
    await unscoped(async () =>
      prisma.system_reports.create({
        data: { category: 'bug', title, body: 'what happened', status, reportedByUserId: reporterId },
      }),
    );

  const candidates = async () =>
    (
      await request(server)
        .get('/api/v1/admin/releases/report-candidates')
        .set('Cookie', operatorCookie)
        .expect(200)
    ).body as { id: number; status: string; shippedInVersion: string | null }[];

  it('offers resolved AND shipped reports, but not open ones', async () => {
    const open = await makeReport('still open', FeedbackStatus.OPEN);
    const resolved = await makeReport('resolved', FeedbackStatus.RESOLVED);
    // A report marked shipped by hand used to be unreachable forever: it had
    // left `resolved`, so no screen could offer it again.
    const shipped = await makeReport('shipped by hand', FeedbackStatus.SHIPPED);

    const ids = (await candidates()).map((r) => r.id);
    expect(ids).toContain(resolved.id);
    expect(ids).toContain(shipped.id);
    expect(ids).not.toContain(open.id);
  });

  it('links a report and marks it shipped', async () => {
    const release = await makeRelease('2.0.0');
    const report = await makeReport('fix me', FeedbackStatus.RESOLVED);

    await request(server)
      .post(`/api/v1/admin/releases/${release.id}/reports/${report.id}`)
      .set('Cookie', operatorCookie)
      .expect(204);

    const after = await unscoped(async () =>
      prisma.system_reports.findUnique({ where: { id: report.id } }),
    );
    expect(after!.shippedInReleaseId).toBe(release.id);
    expect(after!.status).toBe(FeedbackStatus.SHIPPED);
    expect(after!.resolvedAt).not.toBeNull();
  });

  /** Rob's workflow: take it off 2.0.0 and put it on 1.6.3. */
  it('moves a report between releases', async () => {
    const twoOh = await makeRelease('2.0.0');
    const older = await makeRelease('1.6.3');
    const report = await makeReport('moved', FeedbackStatus.RESOLVED);

    await request(server)
      .post(`/api/v1/admin/releases/${twoOh.id}/reports/${report.id}`)
      .set('Cookie', operatorCookie)
      .expect(204);
    await request(server)
      .delete(`/api/v1/admin/releases/reports/${report.id}`)
      .set('Cookie', operatorCookie)
      .expect(204);

    const unlinked = await unscoped(async () =>
      prisma.system_reports.findUnique({ where: { id: report.id } }),
    );
    expect(unlinked!.shippedInReleaseId).toBeNull();
    // Still shipped, and therefore still offered -- which is what makes the
    // move possible rather than stranding it.
    expect(unlinked!.status).toBe(FeedbackStatus.SHIPPED);
    expect((await candidates()).map((r) => r.id)).toContain(report.id);

    await request(server)
      .post(`/api/v1/admin/releases/${older.id}/reports/${report.id}`)
      .set('Cookie', operatorCookie)
      .expect(204);

    const moved = await unscoped(async () =>
      prisma.system_reports.findUnique({ where: { id: report.id } }),
    );
    expect(moved!.shippedInReleaseId).toBe(older.id);
  });

  it('never changes the release body', async () => {
    const body = 'Members earned {{points}} across our {{events}}.';
    const release = await makeRelease('2.0.0', body);
    const report = await makeReport('credit me', FeedbackStatus.RESOLVED);

    await request(server)
      .post(`/api/v1/admin/releases/${release.id}/reports/${report.id}`)
      .set('Cookie', operatorCookie)
      .expect(204);

    const after = await unscoped(async () =>
      prisma.releases.findUnique({ where: { id: release.id } }),
    );
    expect(after!.body).toBe(body);
  });

  it('ships linked reports when the release is published', async () => {
    const release = await makeRelease('2.0.0');
    const report = await makeReport('resolved only', FeedbackStatus.RESOLVED);
    await unscoped(async () =>
      prisma.system_reports.update({
        where: { id: report.id },
        data: { shippedInReleaseId: release.id },
      }),
    );

    await request(server)
      .post(`/api/v1/admin/releases/${release.id}/publish`)
      .set('Cookie', operatorCookie)
      .expect(201);

    const after = await unscoped(async () =>
      prisma.system_reports.findUnique({ where: { id: report.id } }),
    );
    expect(after!.status).toBe(FeedbackStatus.SHIPPED);
  });

  /**
   * The board carries every community's reports, so this is narrower than the
   * rest of ReleasesAdminController, which does admit a root-tenant admin.
   */
  it('refuses a root-tenant admin who is not the operator', async () => {
    const release = await makeRelease('2.0.0');
    const report = await makeReport('nope', FeedbackStatus.RESOLVED);

    await request(server)
      .get('/api/v1/admin/releases/report-candidates')
      .set('Cookie', adminCookie)
      .expect(403);
    await request(server)
      .post(`/api/v1/admin/releases/${release.id}/reports/${report.id}`)
      .set('Cookie', adminCookie)
      .expect(403);
  });
});

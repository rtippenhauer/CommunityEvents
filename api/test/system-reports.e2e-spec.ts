import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestApp,
  truncateAllTables,
  resetThrottler,
  TEST_TENANT_DOMAIN,
} from './utils/test-app';
import { seedCity, seedUser, seedServiceAccount, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { runUnscoped, runWithTenant } from '../src/common/tenant/tenant-store';
import { UserRole } from '../src/database/enums';
import { TEST_TENANT_ID } from './setup-env';
import type { cities as City } from '@prisma/client';

const unscoped = <T>(reason: string, fn: () => Promise<T>): Promise<T> =>
  runUnscoped(reason, async () => await fn());

const inTenant = <T>(tenantId: number, fn: () => Promise<T>): Promise<T> =>
  runWithTenant(tenantId, async () => await fn());

/**
 * The two channels that deliberately cross a tenant boundary (v2-32).
 *
 * Everything here is about *what crosses*. The report crosses; the person does
 * not, except to their own community and to the operator. These are the
 * assertions that make that claim true rather than intended -- the same gap
 * that let `RELEASE_INCLUDE` ship every community's private feedback until a
 * review caught it on 2026-10-02.
 */
describe('System reports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let city: City;

  let rootAdminCookie: string;
  let operatorCookie: string;
  let otherAdminCookie: string;
  let demoAdminCookie: string;

  let rootAdminId: number;
  let otherTenantId: number;
  let demoTenantId: number;
  const otherDomain = 'other-reports.example.test';
  const demoDomain = 'demo-reports.example.test';

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  /** A second community, with a kind (`isDemo`) and an admin of its own. */
  const seedCommunity = async (
    slug: string,
    domain: string,
    email: string,
    isDemo: boolean,
  ): Promise<{ tenantId: number; cookie: string }> => {
    const tenantId = await unscoped(`creating the ${slug} community`, async () => {
      const tenant = await prisma.tenants.create({
        data: { slug, domain, status: 'active', isDemo },
      });
      await prisma.users.create({
        data: {
          tenantId: tenant.id,
          cityId: city.id,
          fullName: `${slug} Admin`,
          email,
          role: UserRole.ADMIN,
          status: 'active',
          emailStatus: 'active',
          emailVerifiedAt: new Date(),
        },
      });
      return tenant.id;
    });

    const admin = await unscoped('finding the new admin', async () =>
      await prisma.users.findFirst({ where: { email } }),
    );
    const cookie = await inTenant(tenantId, () => loginAs(app, admin!));
    return { tenantId, cookie };
  };

  beforeEach(async () => {
    await truncateAllTables(prisma);
    resetThrottler(app);
    city = await seedCity(prisma);

    const rootAdmin = await seedUser(prisma, city.id, {
      role: UserRole.ADMIN,
      email: 'rootadmin@example.test',
      fullName: 'Root Admin',
    });
    const operator = await seedUser(prisma, city.id, {
      role: UserRole.SYSTEM_ADMIN,
      email: 'operator@example.test',
      fullName: 'The Operator',
    });
    rootAdminId = rootAdmin.id;
    rootAdminCookie = await inTenant(TEST_TENANT_ID, () => loginAs(app, rootAdmin));
    operatorCookie = await inTenant(TEST_TENANT_ID, () => loginAs(app, operator));

    ({ tenantId: otherTenantId, cookie: otherAdminCookie } = await seedCommunity(
      'other-reports',
      otherDomain,
      'otheradmin@example.test',
      false,
    ));
    ({ tenantId: demoTenantId, cookie: demoAdminCookie } = await seedCommunity(
      'demo-reports',
      demoDomain,
      'demoadmin@example.test',
      true,
    ));
  });

  const fileBug = () =>
    request(server)
      .post('/api/v1/system/bugs')
      .set('Host', TEST_TENANT_DOMAIN)
      .set('Cookie', rootAdminCookie)
      .send({
        category: 'bug',
        title: 'Calendar feed 500s',
        body: 'Subscribing to the ics feed returns a 500.',
      })
      .expect(201);

  describe('the shared bug board', () => {
    it('lets a non-demo admin file a report', async () => {
      const res = await fileBug();
      expect(res.body.id).toBeGreaterThan(0);
    });

    /**
     * The point of the board: the defect travels so another community can see
     * it is already known.
     */
    /**
     * Feature requests share this board with bugs (Rob, 2026-10-04): both are
     * about the *product*, so both belong to whoever builds it. A general
     * comment is about a community and stays on its own scoped board.
     */
    it('takes a feature request as well as a bug', async () => {
      await request(server)
        .post('/api/v1/system/bugs')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootAdminCookie)
        .send({
          category: 'feature_request',
          title: 'Let members export their RSVPs',
          body: 'A CSV of what I have signed up for would save a lot of scrolling.',
        })
        .expect(201);

      const res = await request(server)
        .get('/api/v1/system/bugs')
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .expect(200);

      expect(res.body[0].category).toBe('feature_request');
    });

    /**
     * Screenshots are stored as **upload paths, never URLs**, and this is the
     * assertion that keeps it that way.
     *
     * They render as `<img src>` on a board the administrators of every
     * community read. An arbitrary URL accepted here would be a tracking pixel
     * reporting which communities opened a report and when, to whoever filed
     * it -- and a way to put a chosen image in front of every operator on the
     * deployment.
     */
    it('refuses a screenshot that is not one of our own uploads', async () => {
      for (const bad of [
        'https://evil.test/pixel.png',
        '//evil.test/pixel.png',
        '/api/uploads/reports/../../etc/passwd',
        // The old flat shape, which stored fine and then 404'd because only
        // named subdirectories are served (found on stage, 2026-10-05).
        '/api/uploads/report-123.png',
        'javascript:alert(1)',
      ]) {
        await request(server)
          .post('/api/v1/system/bugs')
          .set('Host', TEST_TENANT_DOMAIN)
          .set('Cookie', rootAdminCookie)
          .send({
            category: 'bug',
            title: 'With an off-site image',
            body: 'This body is long enough to pass validation.',
            screenshots: [bad],
          })
          .expect(400);
      }
    });

    it('accepts an upload path and gives it back with the report', async () => {
      await request(server)
        .post('/api/v1/system/bugs')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootAdminCookie)
        .send({
          category: 'bug',
          title: 'With a screenshot',
          body: 'This body is long enough to pass validation.',
          screenshots: ['/api/uploads/reports/report-123-456.png'],
        })
        .expect(201);

      const res = await request(server)
        .get('/api/v1/system/bugs')
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .expect(200);

      expect(res.body[0].screenshots).toEqual(['/api/uploads/reports/report-123-456.png']);
    });

    it('caps the number of screenshots', async () => {
      await request(server)
        .post('/api/v1/system/bugs')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootAdminCookie)
        .send({
          category: 'bug',
          title: 'Too many pictures',
          body: 'This body is long enough to pass validation.',
          screenshots: Array.from({ length: 6 }, (_, i) => `/api/uploads/reports/report-${i}.png`),
        })
        .expect(400);
    });

    // A report with none comes back with an empty list, not null -- the board
    // renders it without a guard on every card.
    it('reports an empty screenshot list when there are none', async () => {
      await fileBug();

      const res = await request(server)
        .get('/api/v1/system/bugs')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootAdminCookie)
        .expect(200);

      expect(res.body[0].screenshots).toEqual([]);
    });

    it('refuses a category that is not a product report', async () => {
      await request(server)
        .post('/api/v1/system/bugs')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootAdminCookie)
        .send({ category: 'comment', title: 'Nice venue', body: 'The Thursday place was great.' })
        .expect(400);
    });

    it('shows the report to another community', async () => {
      await fileBug();

      const res = await request(server)
        .get('/api/v1/system/bugs')
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe('Calendar feed 500s');
    });

    /**
     * The load-bearing assertion. The other community must learn the defect and
     * nothing about who hit it -- not the name, and **not the community name
     * either**, which would disclose the deployment's customer list to anybody
     * who obtains a tenant.
     */
    it('never names the reporter to another community', async () => {
      await fileBug();

      const res = await request(server)
        .get('/api/v1/system/bugs')
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .expect(200);

      expect(res.body[0].reporter).toEqual({ kind: 'other' });

      const body = JSON.stringify(res.body);
      expect(body).not.toContain('Root Admin');
      expect(body).not.toContain('rootadmin@example.test');
      // The reporting community is not named either.
      expect(body).not.toContain(TEST_TENANT_DOMAIN);
    });

    it('names the reporter to their own community', async () => {
      await fileBug();

      const res = await request(server)
        .get('/api/v1/system/bugs')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootAdminCookie)
        .expect(200);

      expect(res.body[0].reporter).toEqual({ kind: 'self', fullName: 'Root Admin' });
    });

    // The operator has to know who to answer and where.
    it('gives the operator the name and the community', async () => {
      await fileBug();

      const res = await request(server)
        .get('/api/v1/system/bugs')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', operatorCookie)
        .expect(200);

      expect(res.body[0].reporter).toMatchObject({
        kind: 'operator',
        fullName: 'Root Admin',
      });
      expect(res.body[0].reporter.community).toBeTruthy();
    });

    /**
     * An operator's triage note is not part of the shared record -- it is where
     * "duplicate of X" and "their DNS is wrong" get written.
     */
    it('keeps the operator note off every other community\'s copy', async () => {
      const { body: created } = await fileBug();

      await request(server)
        .patch(`/api/v1/system/bugs/${created.id}`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', operatorCookie)
        .send({ status: 'in_progress', adminNote: 'THEIR INTERNAL NOTE' })
        .expect(200);

      const theirs = await request(server)
        .get('/api/v1/system/bugs')
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .expect(200);
      expect(JSON.stringify(theirs.body)).not.toContain('THEIR INTERNAL NOTE');
      expect(theirs.body[0].status).toBe('in_progress');

      const ours = await request(server)
        .get('/api/v1/system/bugs')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', operatorCookie)
        .expect(200);
      expect(ours.body[0].adminNote).toBe('THEIR INTERNAL NOTE');
    });

    it('refuses triage from a community admin', async () => {
      const { body: created } = await fileBug();

      await request(server)
        .patch(`/api/v1/system/bugs/${created.id}`)
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .send({ status: 'wont_fix' })
        .expect(403);

      // And from an admin of the root tenant who is not the system admin.
      await request(server)
        .patch(`/api/v1/system/bugs/${created.id}`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootAdminCookie)
        .send({ status: 'wont_fix' })
        .expect(403);
    });

    /**
     * The v2-14 lesson, re-tested in a new place. `demo.service` makes every
     * demo requester an admin, so without `NonDemoTenantGuard` "any tenant
     * admin may read the board" means "anybody who filled in the demo form".
     */
    /**
     * Members file, admins read (Rob, 2026-10-04).
     *
     * The asymmetry is the point. The person who hits a bug is usually the
     * member it happened to, and routing them through an admin loses the detail
     * -- or the report. Reading is different: the board carries every other
     * community's operational detail in free text, which a member reporting
     * their own experience has no need of.
     */
    it('lets an ordinary member file but not read the board', async () => {
      const member = await seedUser(prisma, city.id, {
        role: UserRole.MEMBER,
        email: 'member@example.test',
        fullName: 'Ordinary Member',
      });
      const memberCookie = await inTenant(TEST_TENANT_ID, () => loginAs(app, member));

      await request(server)
        .post('/api/v1/system/bugs')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', memberCookie)
        .send({
          category: 'bug',
          title: 'Export is empty',
          body: 'Downloading my data gives a zero-byte file.',
        })
        .expect(201);

      await request(server)
        .get('/api/v1/system/bugs')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', memberCookie)
        .expect(403);

      // And their own community's admins see who filed it.
      const res = await request(server)
        .get('/api/v1/system/bugs')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootAdminCookie)
        .expect(200);
      expect(res.body[0].reporter).toEqual({ kind: 'self', fullName: 'Ordinary Member' });
    });

    it('refuses a demo community at both ends', async () => {
      await fileBug();

      await request(server)
        .get('/api/v1/system/bugs')
        .set('Host', demoDomain)
        .set('Cookie', demoAdminCookie)
        .expect(403);

      await request(server)
        .post('/api/v1/system/bugs')
        .set('Host', demoDomain)
        .set('Cookie', demoAdminCookie)
        .send({ category: 'bug', title: 'From a stranger', body: 'This should never be filed at all.' })
        .expect(403);
    });
  });

  /**
   * The release workflow (Rob, 2026-10-04): a phase pulls in reports, each
   * becomes `resolved` as the code lands, and on release each becomes `shipped`
   * carrying the version -- at which point its author is thanked.
   *
   * **The cross-tenant half is the point.** A release note is one blob of
   * markdown imported identically into every community, so a name written into
   * that text would name one community's member to all the others. The credit is
   * a link instead, resolved per reader.
   */
  describe('shipping a report and crediting its author', () => {
    /**
     * The reporter is deliberately NOT the release author.
     *
     * The author's name is public on a release note everywhere -- it is who
     * wrote the note -- so asserting "Root Admin" is absent proved nothing
     * while the same person filed the report. A separate contributor is what
     * makes the cross-tenant assertion mean something.
     */
    const shipIt = async (version: string) => {
      const reporter = await seedUser(prisma, city.id, {
        role: UserRole.MEMBER,
        email: `reporter-${version}@example.test`,
        fullName: 'Contributing Member',
      });
      const reporterCookie = await inTenant(TEST_TENANT_ID, () => loginAs(app, reporter));

      const { body: created } = await request(server)
        .post('/api/v1/system/bugs')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', reporterCookie)
        .send({
          category: 'bug',
          title: `Shipped in ${version}`,
          body: 'This body is long enough to pass validation.',
        })
        .expect(201);

      const release = await unscoped('seeding a published release', async () =>
        await prisma.releases.create({
          data: {
            version,
            title: 'A release',
            body: 'notes',
            publishedAt: new Date(),
            createdBy: rootAdminId,
          },
        }),
      );

      await request(server)
        .patch(`/api/v1/system/bugs/${created.id}`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', operatorCookie)
        .send({ status: 'shipped', shippedInVersion: version })
        .expect(200);

      return { reportId: created.id as number, releaseId: release.id };
    };

    it('records the version on the report', async () => {
      await shipIt('3.0.0');

      const res = await request(server)
        .get('/api/v1/system/bugs')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', operatorCookie)
        .expect(200);

      expect(res.body[0].status).toBe('shipped');
      expect(res.body[0].shippedInVersion).toBe('3.0.0');
    });

    /**
     * An unknown version is refused rather than ignored: marking a report
     * shipped with a null link would lose the contributor's thanks with no
     * error anywhere.
     */
    it('refuses a version that does not exist', async () => {
      const { body: created } = await fileBug();

      await request(server)
        .patch(`/api/v1/system/bugs/${created.id}`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', operatorCookie)
        .send({ status: 'shipped', shippedInVersion: '9.9.9' })
        .expect(404);
    });

    // At home: the contributor by name, on the release note every community
    // reads from the same markdown.
    it('names the contributor in their own community', async () => {
      await shipIt('3.1.0');

      const res = await request(server)
        .get('/api/v1/releases')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootAdminCookie)
        .expect(200);

      const release = res.body.find((r: { version: string }) => r.version === '3.1.0');
      expect(release.linkedFeedback).toHaveLength(1);
      expect(release.linkedFeedback[0].user.fullName).toBe('Contributing Member');
    });

    /**
     * And everywhere else: counted, never named. This is the assertion that
     * answers "how will the thanks work across tenants".
     */
    it('credits the same release anonymously in another community', async () => {
      await shipIt('3.2.0');

      const res = await request(server)
        .get('/api/v1/releases')
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .expect(200);

      const release = res.body.find((r: { version: string }) => r.version === '3.2.0');
      expect(release.linkedFeedback).toHaveLength(0);
      expect(release.anonymousCredits).toBe(1);
      // The contributor's name does not cross. The release AUTHOR's does, and
      // should: it is who wrote the note, which is the same note everywhere.
      expect(JSON.stringify(res.body)).not.toContain('Contributing Member');
    });

    // Automation does the flipping, so it needs both halves; a community admin
    // needs neither and is refused by the root-tenant guard regardless of role.
    it('lets automation read and triage, and still refuses a community admin', async () => {
      const { body: created } = await fileBug();

      /**
       * **Seeded holding `admin`, not `automation`, and that is the point.**
       *
       * The service account is deliberately flipped between roles so it can
       * browse role-gated pages, and on stage it was sitting at `admin` when
       * this was first tried -- which made a role-keyed check withhold every
       * name at the moment automation was being used. CLAUDE.md says to key on
       * `is_service_account` for exactly this reason; the test holds the code
       * to it by seeding the awkward role rather than the expected one.
       */
      const automation = await seedServiceAccount(prisma, city.id, { role: UserRole.ADMIN });
      const automationCookie = await inTenant(TEST_TENANT_ID, () => loginAs(app, automation));

      /**
       * Automation sees identities, like the system admin (Rob, 2026-10-04).
       *
       * It did not at first, and read every reporter as "a member of another
       * community" -- fine for a release note, where the credit is a link
       * resolved per reader, useless for triage, where knowing who reported
       * what is the job.
       */
      const seen = await request(server)
        .get('/api/v1/system/bugs')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', automationCookie)
        .expect(200);
      expect(seen.body[0].reporter.kind).toBe('operator');
      expect(seen.body[0].reporter.fullName).toBeTruthy();
      expect(seen.body[0].reporter.community).toBeTruthy();

      await request(server)
        .patch(`/api/v1/system/bugs/${created.id}`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', automationCookie)
        .send({ status: 'resolved' })
        .expect(200);

      await request(server)
        .patch(`/api/v1/system/bugs/${created.id}`)
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .send({ status: 'wont_fix' })
        .expect(403);
    });
  });

  describe('demo feedback', () => {
    const submit = () =>
      request(server)
        .post('/api/v1/demo/feedback')
        .set('Host', demoDomain)
        .set('Cookie', demoAdminCookie)
        .send({
          rating: 4,
          wouldUse: 'maybe',
          whatWorked: 'Setting up an event was quick.',
          whatDidnt: 'The invite step confused me.',
        })
        .expect(201);

    it('accepts feedback from inside a demo', async () => {
      const res = await submit();
      expect(res.body.id).toBeGreaterThan(0);
    });

    it('refuses it from a real community', async () => {
      await request(server)
        .post('/api/v1/demo/feedback')
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .send({ body: 'We are not a demo and have our own feedback board.' })
        .expect(403);
    });

    /**
     * Every question is optional on its own; "at least one of them" is the rule,
     * and it lives in the service because the DTO cannot express it and a
     * database CHECK naming the columns would need rewriting per question.
     */
    it('refuses a survey with nothing answered', async () => {
      await request(server)
        .post('/api/v1/demo/feedback')
        .set('Host', demoDomain)
        .set('Cookie', demoAdminCookie)
        .send({})
        .expect(400);
    });

    it('accepts a single answer', async () => {
      await request(server)
        .post('/api/v1/demo/feedback')
        .set('Host', demoDomain)
        .set('Cookie', demoAdminCookie)
        .send({ wouldUse: 'yes' })
        .expect(201);
    });

    it('shows the operator every demo\'s feedback', async () => {
      await submit();

      const res = await request(server)
        .get('/api/v1/demo/feedback')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', operatorCookie)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].rating).toBe(4);
      expect(res.body[0].wouldUse).toBe('maybe');
      // The requester's address, kept so the team can reply once the demo is
      // gone -- and the label is the demo's own host, not the fixture brand
      // name every demo shares (Rob, 2026-10-09).
      expect(res.body[0].submittedByEmail).toBe('demoadmin@example.test');
      expect(res.body[0].demoLabel).toBe('demo-reports');
      expect(res.body[0].whatDidnt).toContain('invite step');
      expect(res.body[0].demoLabel).toBeTruthy();
    });

    it('never shows it to another community', async () => {
      await submit();

      const res = await request(server)
        .get('/api/v1/demo/feedback')
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    /**
     * The reason this table is global, proved rather than asserted.
     *
     * A demo is deleted within a week. Written into the scoped `feedback` table
     * this row would be erased by `purgeTenantRows` along with everything else
     * the demo owned -- readable only while the visitor was still using the
     * product, and gone by the time anybody acted on it.
     */
    it('survives the demo being deleted', async () => {
      await submit();

      await unscoped('deleting the demo the way the sweep does', async () => {
        const { purgeTenantRows } = await import('../src/common/tenant/tenant-purge');
        await prisma.$transaction(
          async (tx) => {
            await purgeTenantRows(tx, demoTenantId);
            await tx.tenants.delete({ where: { id: demoTenantId } });
          },
          { timeout: 30000 },
        );
      });

      const res = await request(server)
        .get('/api/v1/demo/feedback')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', operatorCookie)
        .expect(200);

      expect(res.body).toHaveLength(1);
      // The join is gone, so these two are the only things still saying which
      // demo it was and who to reply to -- which is exactly why both are stored
      // rather than derived.
      expect(res.body[0].demoLabel).toBe('demo-reports');
      expect(res.body[0].submittedByEmail).toBe('demoadmin@example.test');
      expect(res.body[0].whatDidnt).toContain('invite step');
    });

    /**
     * Same property for the bug board, and the reason every foreign key here is
     * SET NULL: a restrictive key would make deleting a community fail on a bug
     * one of its admins filed, and `purgeTenantRows` walks only scoped models so
     * it would never clear it.
     */
    it('lets a community be deleted after its admin filed a bug', async () => {
      await request(server)
        .post('/api/v1/system/bugs')
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .send({
          category: 'bug',
          title: 'Filed then left',
          body: 'The community that reported this is going away.',
        })
        .expect(201);

      await unscoped('deleting the community that filed it', async () => {
        const { purgeTenantRows } = await import('../src/common/tenant/tenant-purge');
        await prisma.$transaction(
          async (tx) => {
            await purgeTenantRows(tx, otherTenantId);
            await tx.tenants.delete({ where: { id: otherTenantId } });
          },
          { timeout: 30000 },
        );
      });

      const res = await request(server)
        .get('/api/v1/system/bugs')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', operatorCookie)
        .expect(200);

      const orphan = res.body.find((b: { title: string }) => b.title === 'Filed then left');
      expect(orphan).toBeDefined();
      // The report outlives the community; the person does not.
      expect(orphan.reporter).toEqual({ kind: 'departed' });
    });
  });

  // Unauthenticated callers get nothing anywhere.
  it('requires a session', async () => {
    await request(server).get('/api/v1/system/bugs').set('Host', TEST_TENANT_DOMAIN).expect(401);
    await request(server).get('/api/v1/demo/feedback').set('Host', demoDomain).expect(401);
  });

  // `rootAdminId` is read by the fixtures above; this keeps the lint honest
  // about it being used rather than incidental.
  it('seeds a root admin', () => {
    expect(rootAdminId).toBeGreaterThan(0);
  });
});

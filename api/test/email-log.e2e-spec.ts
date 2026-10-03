import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { EmailService } from '../src/modules/email/email.service';
import { PrismaService } from '../src/database/prisma/prisma.service';
import type { cities as City } from '@prisma/client';
import { EmailQueueStatus, UserRole } from '../src/database/enums';
import { runUnscoped } from '../src/common/tenant/tenant-store';

/**
 * The email log, searchable and paginated (v2-31).
 *
 * The screen answers one question — "did this member get their invite" — and
 * before this it stopped being able to after a day or two of real volume:
 * `GET /admin/email/queue` was `findMany({ orderBy: createdAt desc, take: 100 })`
 * with no search and no filters. Every test here is about a message that would
 * have been past that cap or unreachable without a filter.
 */
describe('Email log (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let emailService: EmailService;
  let city: City;
  let adminCookie: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    server = app.getHttpServer();
    emailService = app.get(EmailService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    resetThrottler(app);
    city = await seedCity(prisma);
    const admin = await seedUser(prisma, city.id, {
      role: UserRole.ADMIN,
      email: 'admin@example.test',
    });
    adminCookie = await loginAs(app, admin);
  });

  const queueOne = (toEmail: string, subject: string, toName?: string) =>
    emailService.queue({ toEmail, subject, toName, htmlBody: `<p>${subject}</p>` });

  const get = (qs = '') =>
    request(server).get(`/api/v1/admin/email/log${qs}`).set('Cookie', adminCookie).expect(200);

  describe('paging', () => {
    /**
     * The cap was the whole defect. 120 messages is past the old hard limit, so
     * before this the oldest twenty were simply unreachable from the screen.
     */
    it('reaches a message that the old 100-row cap would have hidden', async () => {
      for (let i = 0; i < 120; i += 1) {
        await queueOne(`member${i}@example.test`, `Message ${i}`);
      }

      const first = await get('?limit=50');
      expect(first.body.rows).toHaveLength(50);
      expect(first.body.total).toBe(120);
      expect(first.body.pages).toBe(3);

      // The oldest message is on the last page, and it is reachable.
      const last = await get('?limit=50&page=3');
      expect(last.body.rows).toHaveLength(20);
      expect(last.body.rows.some((r: { subject: string }) => r.subject === 'Message 0')).toBe(true);
    });

    /**
     * Paging has to be stable, and the reason it is not free is `created_at`:
     * the column is DATETIME(0), so a fan-out writing one row per member inside
     * one second produces dozens of rows sharing a timestamp. Ordered by that
     * column alone, the ties come back in whatever order the engine picks, and
     * under OFFSET/LIMIT that means a row can appear on two consecutive pages
     * while another is skipped — so an operator scanning the log after a bulk
     * send misses messages without any sign of it.
     *
     * Found by the test above failing only when run after other specs: the
     * order was arbitrary, so which page a given message landed on varied.
     * `id` is the tiebreaker that makes the order total.
     */
    it('pages without skipping or repeating a row', async () => {
      // Written in one burst on purpose, so they share a whole-second
      // `created_at` and exercise the tie.
      for (let i = 0; i < 75; i += 1) {
        await queueOne(`burst${i}@example.test`, `Burst ${i}`);
      }

      const seen: number[] = [];
      for (let page = 1; page <= 3; page += 1) {
        const res = await get(`?limit=25&page=${page}`);
        seen.push(...res.body.rows.map((r: { id: number }) => r.id));
      }

      expect(seen).toHaveLength(75);
      // Every row exactly once: a duplicate means another was skipped.
      expect(new Set(seen).size).toBe(75);
      // And strictly descending across page boundaries, not only within a page.
      expect([...seen].sort((a, b) => b - a)).toEqual(seen);
    });

    it('orders newest first, so the page a reader lands on is the recent one', async () => {
      await queueOne('older@example.test', 'Older');
      await queueOne('newer@example.test', 'Newer');

      const res = await get();
      const ids = res.body.rows.map((r: { id: number }) => r.id);
      expect(ids[0]).toBeGreaterThan(ids[1]);
    });

    // A page past the end would otherwise render as an empty log, which reads
    // as "nothing was ever sent" rather than as "you are past the end".
    it('reports the real page count for an out-of-range page', async () => {
      await queueOne('only@example.test', 'Only');
      const res = await get('?page=9');
      expect(res.body.pages).toBe(1);
      expect(res.body.total).toBe(1);
    });

    it('refuses an unbounded limit', async () => {
      await request(server)
        .get('/api/v1/admin/email/log?limit=100000')
        .set('Cookie', adminCookie)
        .expect(400);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await queueOne('alice@example.test', 'Your invite to dinner', 'Alice Smith');
      await queueOne('bob@example.test', 'Password reset', 'Bob Jones');
    });

    it('finds a message by recipient address', async () => {
      const res = await get('?q=alice@example.test');
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].toEmail).toBe('alice@example.test');
    });

    it('finds a message by subject', async () => {
      const res = await get('?q=Password');
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].toEmail).toBe('bob@example.test');
    });

    it('finds a message by recipient name', async () => {
      const res = await get('?q=Smith');
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].toEmail).toBe('alice@example.test');
    });

    // MySQL's collation is case-insensitive and Prisma's `mode: 'insensitive'`
    // is an error on MySQL rather than a no-op, so this pins the behaviour we
    // are relying on rather than the one we asked for.
    it('is case-insensitive', async () => {
      const res = await get('?q=PASSWORD');
      expect(res.body.rows).toHaveLength(1);
    });

    it('counts only what matched, so the paginator agrees with the rows', async () => {
      const res = await get('?q=alice');
      expect(res.body.total).toBe(1);
      expect(res.body.pages).toBe(1);
    });
  });

  describe('filters', () => {
    it('filters by status', async () => {
      const sent = await queueOne('sent@example.test', 'Sent one');
      await queueOne('pending@example.test', 'Pending one');
      await prisma.email_queue.update({
        where: { id: sent!.id },
        data: { status: EmailQueueStatus.SENT },
      });

      const res = await get('?status=sent');
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].toEmail).toBe('sent@example.test');
    });

    it('rejects a status that is not one', async () => {
      await request(server)
        .get('/api/v1/admin/email/log?status=banana')
        .set('Cookie', adminCookie)
        .expect(400);
    });

    /**
     * The inclusive-end trap. A bare `YYYY-MM-DD` parses as that day's midnight,
     * so without widening it to the end of the day, filtering "to today"
     * returns nothing sent today — the day somebody filtering by date is most
     * often asking about.
     */
    it('includes the whole of a date-only `to` day', async () => {
      await queueOne('today@example.test', 'Today');
      const today = new Date().toISOString().slice(0, 10);

      const res = await get(`?to=${today}`);
      expect(res.body.rows).toHaveLength(1);
    });

    it('excludes what falls outside the range', async () => {
      await queueOne('today@example.test', 'Today');
      const res = await get('?from=2099-01-01');
      expect(res.body.rows).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });

    it('rejects a date that is not one', async () => {
      await request(server)
        .get('/api/v1/admin/email/log?from=last%20tuesday')
        .set('Cookie', adminCookie)
        .expect(400);
    });
  });

  /**
   * The counts exist because the screen's Retry button used to be driven by
   * `queue().filter(...)` over the loaded rows — correct only while every row
   * was loaded. Under paging that silently becomes "failed on this page", so a
   * second page of failures would report none.
   */
  describe('per-status counts', () => {
    it('counts the whole community, not the page', async () => {
      for (let i = 0; i < 60; i += 1) await queueOne(`f${i}@example.test`, `Failed ${i}`);
      await prisma.email_queue.updateMany({ data: { status: EmailQueueStatus.FAILED } });

      const res = await get('?limit=25');
      expect(res.body.rows).toHaveLength(25);
      expect(res.body.counts.failed).toBe(60);
    });

    it('ignores the active filters, so the queue totals stay visible while searching', async () => {
      await queueOne('alice@example.test', 'One');
      await queueOne('bob@example.test', 'Two');

      const res = await get('?q=alice');
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.counts.pending).toBe(2);
    });

    it('reports zero for a status with no rows rather than omitting it', async () => {
      await queueOne('only@example.test', 'Only');
      const res = await get();
      expect(res.body.counts.failed).toBe(0);
      expect(res.body.counts.cancelled).toBe(0);
    });
  });

  describe('message content', () => {
    /**
     * The reason the list is cheap. `html_body` is LongText, so carrying it on
     * every row made the response grow with the community's mail rather than
     * with the page.
     */
    it('is absent from the list', async () => {
      await queueOne('body@example.test', 'Has a body');
      const res = await get();
      expect(res.body.rows[0].htmlBody).toBeUndefined();
      expect(res.body.rows[0].textBody).toBeUndefined();
      expect(res.body.rows[0].templateParams).toBeUndefined();
    });

    it('is fetched for one message by id', async () => {
      const row = await queueOne('body@example.test', 'Has a body');
      const res = await request(server)
        .get(`/api/v1/admin/email/log/${row!.id}`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.id).toBe(row!.id);
      expect(res.body.htmlBody).toContain('Has a body');
    });

    it('404s for a message that does not exist', async () => {
      await request(server)
        .get('/api/v1/admin/email/log/999999')
        .set('Cookie', adminCookie)
        .expect(404);
    });
  });

  // The log is this community's mail and nobody else's. `email_queue` is
  // tenant-scoped, so the extension supplies the predicate -- this asserts the
  // property rather than trusting it, because the whole screen is a read across
  // a table every community writes to.
  describe('tenant isolation', () => {
    it('never lists another community\'s mail', async () => {
      await queueOne('ours@example.test', 'Ours');

      const other = await createOtherTenant(prisma);
      await queueForTenant(prisma, other, 'theirs@example.test');

      const res = await get();
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].toEmail).toBe('ours@example.test');
      expect(res.body.total).toBe(1);
      expect(res.body.counts.pending).toBe(1);
    });
  });
});

/**
 * A second community, to prove the log cannot see across.
 *
 * Awaited inside the callback rather than returned from it: Prisma promises are
 * lazy, so returning one would build the query in the waived context and run it
 * outside — the trap recorded in CLAUDE.md.
 */
async function createOtherTenant(prisma: PrismaService): Promise<number> {
  return runUnscoped('creating a second community for an isolation test', async () => {
    const tenant = await prisma.tenants.create({
      data: { slug: 'other-log', domain: 'other-log.example.test', status: 'active' },
    });
    return tenant.id;
  });
}

async function queueForTenant(
  prisma: PrismaService,
  tenantId: number,
  toEmail: string,
): Promise<void> {
  await runUnscoped("seeding another community's mail", async () => {
    await prisma.email_queue.create({
      data: { tenantId, toEmail, subject: 'Theirs', htmlBody: '<p>theirs</p>' },
    });
  });
}

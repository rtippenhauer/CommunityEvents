import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { EmailService } from '../src/modules/email/email.service';
import { PrismaService } from '../src/database/prisma/prisma.service';
import type { cities as City } from '@prisma/client';
import { EmailQueueStatus, UserRole } from '../src/database/enums';
import { EmailCategory, EmailTemplate } from '../src/modules/email/email.constants';
import { runUnscoped } from '../src/common/tenant/tenant-store';

/** Reads across communities, which is what inspecting the stored row requires. */
const unscoped = <T>(reason: string, fn: () => Promise<T>): Promise<T> =>
  runUnscoped(reason, async () => await fn());

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

  /**
   * Why a message went out, and how long its body is kept (Rob, 2026-10-03).
   *
   * The log answered "what happened to this message" and not "why does it
   * exist". `templateId` looked like the answer and is not one -- it is a
   * dispatch instruction that picks a Brevo template and a member's opt-out, and
   * only 4 of the 21 send sites set it, so the column read "—" for almost
   * everything.
   */
  describe('category', () => {
    it('records why a message was queued', async () => {
      await emailService.queue({
        toEmail: 'cat@example.test',
        subject: 'Hi',
        htmlBody: '<p>hi</p>',
        category: EmailCategory.EVENT_REMINDER,
      });

      const res = await get();
      expect(res.body.rows[0].category).toBe('event_reminder');
    });

    /**
     * `other`, not NULL. NULL means "this row predates the column", so
     * conflating the two would make the log's Unknown rows grow forever instead
     * of shrinking as old mail ages out.
     */
    it('records `other` when the sender named nothing', async () => {
      await emailService.queue({
        toEmail: 'uncategorised@example.test',
        subject: 'Hi',
        htmlBody: '<p>hi</p>',
      });

      const res = await get();
      expect(res.body.rows[0].category).toBe('other');
    });

    it('filters by it', async () => {
      await emailService.queue({
        toEmail: 'reminder@example.test',
        subject: 'A',
        htmlBody: '<p>a</p>',
        category: EmailCategory.EVENT_REMINDER,
      });
      await emailService.queue({
        toEmail: 'invite@example.test',
        subject: 'B',
        htmlBody: '<p>b</p>',
        category: EmailCategory.INVITE,
      });

      const res = await get('?category=invite');
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].toEmail).toBe('invite@example.test');
      expect(res.body.total).toBe(1);
    });

    it('rejects a category that is not one', async () => {
      await request(server)
        .get('/api/v1/admin/email/log?category=banana')
        .set('Cookie', adminCookie)
        .expect(400);
    });

    /**
     * The property that keeps this honest: a label must never change what a
     * member receives. Nothing branches on `category`, so a templated send is
     * unaffected by carrying one.
     */
    it('does not disturb the template a message is sent with', async () => {
      const row = await emailService.queue({
        toEmail: 'templated@example.test',
        subject: 'Hi',
        htmlBody: '<p>hi</p>',
        templateId: EmailTemplate.INVITE,
        category: EmailCategory.EVENT_REMINDER,
      });

      const stored = await unscoped('reading the row', () =>
        prisma.email_queue.findUnique({ where: { id: row!.id } }),
      );
      expect(stored!.templateId).toBe('invite');
      expect(stored!.category).toBe('event_reminder');
    });
  });

  /**
   * Retention: the body goes, the row stays (Rob, 2026-10-03).
   *
   * Nothing pruned `email_queue` before this and it carries `html_body` as
   * LongText. Keeping the envelope means "did we ever send Dana her invite"
   * stays answerable long after the rendered HTML stops being interesting.
   */
  describe('body retention', () => {
    const age = async (id: number, days: number) =>
      unscoped('ageing a message', () =>
        prisma.email_queue.update({
          where: { id },
          data: {
            createdAt: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
            status: EmailQueueStatus.SENT,
          },
        }),
      );

    it('clears the body of an old message but keeps the row', async () => {
      const row = await emailService.queue({
        toEmail: 'old@example.test',
        subject: 'Ancient',
        htmlBody: '<p>secret</p>',
        textBody: 'secret',
      });
      await age(row!.id, 45);

      const cleared = await emailService.clearOldBodies();
      expect(cleared).toBe(1);

      const after = await unscoped('reading it back', () =>
        prisma.email_queue.findUnique({ where: { id: row!.id } }),
      );
      // The envelope survives -- this is what the log is for.
      expect(after).not.toBeNull();
      expect(after!.toEmail).toBe('old@example.test');
      expect(after!.subject).toBe('Ancient');
      expect(after!.status).toBe(EmailQueueStatus.SENT);
      // The expensive part is gone.
      expect(after!.htmlBody).toBeNull();
      expect(after!.textBody).toBeNull();
      expect(after!.bodyClearedAt).not.toBeNull();
    });

    it('leaves a message inside the window alone', async () => {
      const row = await emailService.queue({
        toEmail: 'recent@example.test',
        subject: 'Recent',
        htmlBody: '<p>keep me</p>',
      });
      await age(row!.id, 5);

      expect(await emailService.clearOldBodies()).toBe(0);

      const after = await unscoped('reading it back', () =>
        prisma.email_queue.findUnique({ where: { id: row!.id } }),
      );
      expect(after!.htmlBody).toContain('keep me');
    });

    /**
     * Pending and failed messages keep their bodies whatever their age -- the
     * dispatcher still intends to send them, and clearing the body would turn a
     * retry into an empty email.
     */
    it('never clears a message that is still waiting to go', async () => {
      const row = await emailService.queue({
        toEmail: 'stuck@example.test',
        subject: 'Stuck',
        htmlBody: '<p>still needed</p>',
      });
      await unscoped('ageing it while leaving it pending', () =>
        prisma.email_queue.update({
          where: { id: row!.id },
          data: {
            createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
            status: EmailQueueStatus.PENDING,
          },
        }),
      );

      expect(await emailService.clearOldBodies()).toBe(0);

      const after = await unscoped('reading it back', () =>
        prisma.email_queue.findUnique({ where: { id: row!.id } }),
      );
      expect(after!.htmlBody).toContain('still needed');
    });

    /**
     * `bodyClearedAt` is what makes the sweep idempotent. An empty body is
     * otherwise indistinguishable from a message that never had one -- a
     * provider-template send stores none -- so a second run would report work it
     * had not done.
     */
    it('does not re-clear what it has already cleared', async () => {
      const row = await emailService.queue({
        toEmail: 'twice@example.test',
        subject: 'Twice',
        htmlBody: '<p>x</p>',
      });
      await age(row!.id, 45);

      expect(await emailService.clearOldBodies()).toBe(1);
      expect(await emailService.clearOldBodies()).toBe(0);
    });

    it('honours a different window', async () => {
      const row = await emailService.queue({
        toEmail: 'window@example.test',
        subject: 'Window',
        htmlBody: '<p>x</p>',
      });
      await age(row!.id, 10);

      // Outside 30 days, inside 7.
      expect(await emailService.clearOldBodies(new Date(), 30)).toBe(0);
      expect(await emailService.clearOldBodies(new Date(), 7)).toBe(1);
    });
  });

  /**
   * How often the log is read, and how far back (Rob, 2026-10-03).
   *
   * Deleting rows at 6 or 12 months is deliberately undecided, and this is the
   * evidence for deciding it rather than guessing. The useful half is not the
   * count but the reach: if nobody has opened anything older than a month, six
   * months is plainly safe.
   */
  describe('review tracking', () => {
    it('counts a day on which the log was read', async () => {
      await queueOne('seen@example.test', 'Seen');

      const res = await get();

      expect(res.body.usage.daysReviewed).toBe(1);
      expect(res.body.usage.lastReviewedAt).not.toBeNull();
    });

    /**
     * One row per day, not per request. The debounced search fires on every
     * pause in typing, so a request-level record would be mostly noise.
     */
    it('does not count the same day twice', async () => {
      await queueOne('seen@example.test', 'Seen');

      await get();
      await get();
      const third = await get();

      expect(third.body.usage.daysReviewed).toBe(1);

      const rows = await unscoped('reading the usage table', () =>
        prisma.email_log_views.findMany(),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].views).toBe(3);
    });

    /**
     * The load-bearing column. It records the age of the oldest message the
     * reader actually reached, which is what says whether a retention window
     * would have thrown away something somebody wanted.
     */
    it('records how far back the reader reached', async () => {
      const row = await queueOne('old@example.test', 'Old');
      await unscoped('ageing the message', () =>
        prisma.email_queue.update({
          where: { id: row!.id },
          // 40 days plus an hour: `created_at` is DATETIME(0) and MySQL ROUNDS
          // fractional seconds rather than truncating, so an exact 40-day offset
          // can be stored a half-second late and floor to 39. The buffer keeps
          // the assertion about the metric rather than about rounding.
          data: { createdAt: new Date(Date.now() - (40 * 24 + 1) * 60 * 60 * 1000) },
        }),
      );

      const res = await get();
      expect(res.body.usage.deepestAgeDays).toBe(40);
    });

    // Only ever grows: a shallow read after a deep one must not erase the
    // evidence that somebody once went back a long way.
    it('keeps the deepest reach, not the most recent one', async () => {
      const old = await queueOne('old@example.test', 'Old');
      await unscoped('ageing the message', () =>
        prisma.email_queue.update({
          where: { id: old!.id },
          // 40 days plus an hour: `created_at` is DATETIME(0) and MySQL ROUNDS
          // fractional seconds rather than truncating, so an exact 40-day offset
          // can be stored a half-second late and floor to 39. The buffer keeps
          // the assertion about the metric rather than about rounding.
          data: { createdAt: new Date(Date.now() - (40 * 24 + 1) * 60 * 60 * 1000) },
        }),
      );
      await get();

      // A later, shallower read: filtered to today only.
      const today = new Date().toISOString().slice(0, 10);
      const res = await get(`?from=${today}`);

      expect(res.body.usage.deepestAgeDays).toBe(40);
    });

    it('reports nothing reviewed on a log nobody has opened', async () => {
      const usage = await unscoped('reading the usage table', () =>
        prisma.email_log_views.count(),
      );
      expect(usage).toBe(0);
    });

    // A statistic must never fail the screen it is measuring.
    it('still answers if the usage write fails', async () => {
      await queueOne('resilient@example.test', 'Resilient');
      // Stubs the counter WRITE, not the method that guards it -- replacing
      // `recordLogView` itself would bypass the try/catch being tested and
      // prove nothing. The log's own reads use findMany/count, so nothing else
      // in this request goes through $executeRaw.
      const client = app.get(PrismaService) as unknown as {
        $executeRaw: (...args: unknown[]) => Promise<number>;
      };
      const original = client.$executeRaw.bind(client);
      client.$executeRaw = async () => {
        throw new Error('counter is down');
      };

      const res = await request(server)
        .get('/api/v1/admin/email/log')
        .set('Cookie', adminCookie);

      client.$executeRaw = original;
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
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

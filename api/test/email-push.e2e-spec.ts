import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { EmailService } from '../src/modules/email/email.service';
import { EmailTemplate } from '../src/modules/email/email.constants';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { PrismaService } from '../src/database/prisma/prisma.service';
import type { cities as City, email_queue as EmailQueue, notification_preferences as NotificationPreferences, notifications as Notification, push_subscriptions as PushSubscription, users as User } from '@prisma/client';
import { EmailQueueStatus, EmailStatus, SuppressionReason, UserRole } from '../src/database/enums';

describe('Email/Push Dispatch (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let emailService: EmailService;
  let notificationsService: NotificationsService;

  let city: City;
  let adminCookie: string;
  let moderatorCookie: string;
  let member: User;
  let memberCookie: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    server = app.getHttpServer();
    emailService = app.get(EmailService);
    notificationsService = app.get(NotificationsService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    resetThrottler(app);
    city = await seedCity(prisma);

    const admin = await seedUser(prisma, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    const moderator = await seedUser(prisma, city.id, { role: UserRole.MODERATOR, email: 'mod@example.test' });
    member = await seedUser(prisma, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
    adminCookie = await loginAs(app, admin);
    moderatorCookie = await loginAs(app, moderator);
    memberCookie = await loginAs(app, member);
  });

  describe('EmailService.queue() blocking rules', () => {
    it('queues a pending email under normal conditions', async () => {
      const row = await emailService.queue({ toEmail: 'someone@example.test', subject: 'Hi', htmlBody: '<p>hi</p>' });
      expect(row).not.toBeNull();
      expect(row!.status).toBe(EmailQueueStatus.PENDING);
    });

    it('does not queue an email for a suppressed address', async () => {
      await emailService.suppress('suppressed@example.test', SuppressionReason.UNSUBSCRIBED);

      const row = await emailService.queue({ toEmail: 'suppressed@example.test', subject: 'Hi', htmlBody: '<p>hi</p>' });
      expect(row).toBeNull();
      const count = await prisma.email_queue.count();
      expect(count).toBe(0);
    });

    it('does not queue a templated email for a bounced user', async () => {
      const bounced = await seedUser(prisma, city.id, { email: 'bounced@example.test', emailStatus: EmailStatus.BOUNCED });

      const row = await emailService.queue({
        toEmail: bounced.email,
        subject: 'Invite',
        templateId: EmailTemplate.INVITE,
        userId: bounced.id,
      });
      expect(row).toBeNull();
    });

    it('does not queue a templated email when the user has opted out via notification preferences', async () => {
      const optedOut = await seedUser(prisma, city.id, { email: 'opted-out@example.test' });
      await prisma.notification_preferences.create({ data: { userId: optedOut.id, emailInvite: false } });

      const row = await emailService.queue({
        toEmail: optedOut.email,
        subject: 'Invite',
        templateId: EmailTemplate.INVITE,
        userId: optedOut.id,
      });
      expect(row).toBeNull();
    });

    it('bypasses suppression when bypassSuppression is set', async () => {
      await emailService.suppress('bypass@example.test', SuppressionReason.BOUNCED);

      const row = await emailService.queue({
        toEmail: 'bypass@example.test',
        subject: 'Hi',
        htmlBody: '<p>hi</p>',
        bypassSuppression: true,
      });
      expect(row).not.toBeNull();
    });
  });

  describe('POST /admin/email/flush (EmailDispatcherService.dispatchPending)', () => {
    it('marks a pending email as blocked when no provider is configured', async () => {
      const row = await emailService.queue({ toEmail: 'flush-me@example.test', subject: 'Hi', htmlBody: '<p>hi</p>' });

      await request(server).post('/api/v1/admin/email/flush').set('Cookie', adminCookie).expect(200);

      const updated = await prisma.email_queue.findFirst({ where: { id: row!.id } });
      expect(updated!.status).toBe(EmailQueueStatus.BLOCKED);
      expect(updated!.errorMessage).toBe('No provider available or daily limit reached');
    });

    it('rejects a moderator flushing the queue (admin-only)', async () => {
      await request(server).post('/api/v1/admin/email/flush').set('Cookie', moderatorCookie).expect(403);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).post('/api/v1/admin/email/flush').expect(401);
    });
  });

  describe('GET/PATCH /admin/email/config', () => {
    it('returns an empty response immediately after a truncate, before any dispatch has run', async () => {
      // Controller returns the raw findOne() result (null when no row exists yet);
      // Nest/Express sends that as an empty body rather than the JSON literal
      // "null", so the observable behavior is an empty response text.
      const res = await request(server).get('/api/v1/admin/email/config').set('Cookie', adminCookie).expect(200);
      expect(res.text).toBe('');
    });

    it('creates the config row on the first save, and admin can update it', async () => {
      // v2-9 changed what creates it. The row used to be a deployment-wide
      // singleton written by seed.ts, so it existed for everybody and the
      // dispatcher only ever self-healed a deleted one. It now belongs to a
      // community, and a community that has never sent mail has none -- so the
      // admin screen has to be able to make it, or the first save would be
      // silently discarded.
      await request(server)
        .patch('/api/v1/admin/email/config')
        .set('Cookie', adminCookie)
        .send({ brevoEnabled: false })
        .expect(200);

      const updated = await request(server).get('/api/v1/admin/email/config').set('Cookie', adminCookie).expect(200);
      // Wire-format change from the Prisma swap: TINYINT(1) came back from
      // TypeORM as 0/1 and now comes back as a real boolean. The frontend
      // already declared these fields `boolean` and binds them to [checked],
      // so the JSON now matches the type it always claimed to have.
      expect(updated.body.brevoEnabled).toBe(false);
    });

    it('rejects a moderator reading or updating email config (admin-only)', async () => {
      await request(server).get('/api/v1/admin/email/config').set('Cookie', moderatorCookie).expect(403);
      await request(server).patch('/api/v1/admin/email/config').set('Cookie', moderatorCookie).send({}).expect(403);
    });
  });

  describe('GET /admin/email/queue, POST /admin/email/retry-failed, DELETE /admin/email/:id', () => {
    it('lists queued emails for admin', async () => {
      await emailService.queue({ toEmail: 'listed@example.test', subject: 'Hi', htmlBody: '<p>hi</p>' });
      const res = await request(server).get('/api/v1/admin/email/queue').set('Cookie', adminCookie).expect(200);
      expect(res.body.some((e: { toEmail: string }) => e.toEmail === 'listed@example.test')).toBe(true);
    });

    it('retries failed emails, resetting them to pending', async () => {
      const row = await emailService.queue({ toEmail: 'retry-me@example.test', subject: 'Hi', htmlBody: '<p>hi</p>' });
      await prisma.email_queue.update({ where: { id: row!.id }, data: { status: EmailQueueStatus.FAILED } });

      const res = await request(server).post('/api/v1/admin/email/retry-failed').set('Cookie', adminCookie).expect(200);
      expect(res.body.retried).toBe(1);

      const updated = await prisma.email_queue.findFirst({ where: { id: row!.id } });
      expect(updated!.status).toBe(EmailQueueStatus.PENDING);
    });

    it('cancels a queued email', async () => {
      const row = await emailService.queue({ toEmail: 'cancel-me@example.test', subject: 'Hi', htmlBody: '<p>hi</p>' });

      await request(server).delete(`/api/v1/admin/email/${row!.id}`).set('Cookie', adminCookie).expect(200);

      const updated = await prisma.email_queue.findFirst({ where: { id: row!.id } });
      expect(updated!.status).toBe(EmailQueueStatus.CANCELLED);
    });

    it('rejects a member reading the queue (admin-only)', async () => {
      await request(server).get('/api/v1/admin/email/queue').set('Cookie', memberCookie).expect(403);
    });
  });

  describe('POST /email/webhook/brevo (public — Brevo delivery events)', () => {
    it('activates a pending user on a delivered event', async () => {
      const pending = await seedUser(prisma, city.id, { email: 'webhook-delivered@example.test', emailStatus: EmailStatus.PENDING });

      await request(server)
        .post('/api/v1/email/webhook/brevo')
        .query({ secret: process.env.BREVO_WEBHOOK_SECRET })
        .send({ event: 'delivered', email: pending.email })
        .expect(201);

      const updated = await prisma.users.findFirst({ where: { id: pending.id } });
      expect(updated!.emailStatus).toBe(EmailStatus.ACTIVE);
    });

    it('marks a user bounced and suppresses their address on a hard_bounce event', async () => {
      const user = await seedUser(prisma, city.id, { email: 'webhook-bounce@example.test' });

      await request(server)
        .post('/api/v1/email/webhook/brevo')
        .query({ secret: process.env.BREVO_WEBHOOK_SECRET })
        .send({ event: 'hard_bounce', email: user.email })
        .expect(201);

      const updated = await prisma.users.findFirst({ where: { id: user.id } });
      expect(updated!.emailStatus).toBe(EmailStatus.BOUNCED);
      expect(await emailService.isSuppressed(user.email)).toBe(true);
    });

    it('marks a user unsubscribed on an unsubscribed event', async () => {
      const user = await seedUser(prisma, city.id, { email: 'webhook-unsub@example.test' });

      await request(server)
        .post('/api/v1/email/webhook/brevo')
        .query({ secret: process.env.BREVO_WEBHOOK_SECRET })
        .send({ event: 'unsubscribed', email: user.email })
        .expect(201);

      const updated = await prisma.users.findFirst({ where: { id: user.id } });
      expect(updated!.emailStatus).toBe(EmailStatus.UNSUBSCRIBED);
    });

    it('marks a user complained and suppresses on a spam event', async () => {
      const user = await seedUser(prisma, city.id, { email: 'webhook-spam@example.test' });

      await request(server)
        .post('/api/v1/email/webhook/brevo')
        .query({ secret: process.env.BREVO_WEBHOOK_SECRET })
        .send({ event: 'spam', email: user.email })
        .expect(201);

      const updated = await prisma.users.findFirst({ where: { id: user.id } });
      expect(updated!.emailStatus).toBe(EmailStatus.COMPLAINED);
      expect(await emailService.isSuppressed(user.email)).toBe(true);
    });

    it('accepts a batch array of events and processes each one', async () => {
      const userA = await seedUser(prisma, city.id, { email: 'batch-a@example.test', emailStatus: EmailStatus.PENDING });
      const userB = await seedUser(prisma, city.id, { email: 'batch-b@example.test', emailStatus: EmailStatus.PENDING });

      await request(server)
        .post('/api/v1/email/webhook/brevo')
        .query({ secret: process.env.BREVO_WEBHOOK_SECRET })
        .send([
          { event: 'delivered', email: userA.email },
          { event: 'delivered', email: userB.email },
        ])
        .expect(201);

      const [a, b] = await Promise.all([
        prisma.users.findFirst({ where: { id: userA.id } }),
        prisma.users.findFirst({ where: { id: userB.id } }),
      ]);
      expect(a!.emailStatus).toBe(EmailStatus.ACTIVE);
      expect(b!.emailStatus).toBe(EmailStatus.ACTIVE);
    });

    it('does not error for an unknown email address', async () => {
      await request(server)
        .post('/api/v1/email/webhook/brevo')
        .query({ secret: process.env.BREVO_WEBHOOK_SECRET })
        .send({ event: 'delivered', email: 'nobody@example.test' })
        .expect(201);
    });
  });

  describe('Push subscription: POST/DELETE /notifications/push/subscribe', () => {
    it('subscribes a device for push notifications', async () => {
      await request(server)
        .post('/api/v1/notifications/push/subscribe')
        .set('Cookie', memberCookie)
        .send({ endpoint: 'https://push.example.test/abc', keys: { p256dh: 'p256dh-key', auth: 'auth-secret' } })
        .expect(204);

      const sub = await prisma.push_subscriptions
        .findFirst({ where: { userId: member.id, endpoint: 'https://push.example.test/abc' } });
      expect(sub).toBeTruthy();
    });

    it('upserts on a repeat subscribe for the same endpoint', async () => {
      const endpoint = 'https://push.example.test/upsert';
      await request(server)
        .post('/api/v1/notifications/push/subscribe')
        .set('Cookie', memberCookie)
        .send({ endpoint, keys: { p256dh: 'old-key', auth: 'old-secret' } })
        .expect(204);
      await request(server)
        .post('/api/v1/notifications/push/subscribe')
        .set('Cookie', memberCookie)
        .send({ endpoint, keys: { p256dh: 'new-key', auth: 'new-secret' } })
        .expect(204);

      const subs = await prisma.push_subscriptions.findMany({ where: { endpoint } });
      expect(subs).toHaveLength(1);
      expect(subs[0].p256dh).toBe('new-key');
    });

    it('rejects a subscribe payload missing keys', async () => {
      await request(server)
        .post('/api/v1/notifications/push/subscribe')
        .set('Cookie', memberCookie)
        .send({ endpoint: 'https://push.example.test/bad' })
        .expect(400);
    });

    it('unsubscribes a device', async () => {
      const endpoint = 'https://push.example.test/unsub';
      await request(server)
        .post('/api/v1/notifications/push/subscribe')
        .set('Cookie', memberCookie)
        .send({ endpoint, keys: { p256dh: 'k', auth: 'a' } })
        .expect(204);

      await request(server).delete('/api/v1/notifications/push/subscribe').set('Cookie', memberCookie).send({ endpoint }).expect(204);

      const sub = await prisma.push_subscriptions.findFirst({ where: { endpoint } });
      expect(sub).toBeNull();
    });

    it('rejects unauthenticated subscribe requests', async () => {
      await request(server)
        .post('/api/v1/notifications/push/subscribe')
        .send({ endpoint: 'https://push.example.test/anon', keys: { p256dh: 'k', auth: 'a' } })
        .expect(401);
    });
  });

  describe('In-app notifications: GET/PATCH /notifications', () => {
    it('lists notifications for the current user', async () => {
      await notificationsService.create({ userId: member.id, type: 'security_alert', title: 'New sign-in', body: 'test' });

      const res = await request(server).get('/api/v1/notifications').set('Cookie', memberCookie).expect(200);
      expect(res.body.some((n: { title: string }) => n.title === 'New sign-in')).toBe(true);
    });

    it('reports an accurate unread count', async () => {
      // loginAs() in beforeEach goes through the real issueTokens() flow, which
      // itself creates a "new sign-in" notification — so the baseline isn't 0.
      const baseline = await request(server).get('/api/v1/notifications/unread-count').set('Cookie', memberCookie).expect(200);

      await notificationsService.create({ userId: member.id, type: 'security_alert', title: 'One' });
      await notificationsService.create({ userId: member.id, type: 'security_alert', title: 'Two' });

      const res = await request(server).get('/api/v1/notifications/unread-count').set('Cookie', memberCookie).expect(200);
      expect(res.body.count).toBe(baseline.body.count + 2);
    });

    it('marks a single notification as read', async () => {
      await notificationsService.create({ userId: member.id, type: 'security_alert', title: 'Mark me' });
      const list = await request(server).get('/api/v1/notifications').set('Cookie', memberCookie).expect(200);
      const target = list.body[0];

      await request(server).patch(`/api/v1/notifications/${target.id}/read`).set('Cookie', memberCookie).expect(200);

      const updated = await prisma.notifications.findFirst({ where: { id: target.id } });
      expect(updated!.isRead).toBe(true);
    });

    it("does not let a member mark another user's notification as read", async () => {
      const other = await seedUser(prisma, city.id, { email: 'other-notif@example.test' });
      await notificationsService.create({ userId: other.id, type: 'security_alert', title: "Not yours" });
      const theirs = await prisma.notifications.findFirst({ where: { userId: other.id } });

      await request(server).patch(`/api/v1/notifications/${theirs!.id}/read`).set('Cookie', memberCookie).expect(200);

      const stillUnread = await prisma.notifications.findFirst({ where: { id: theirs!.id } });
      expect(stillUnread!.isRead).toBe(false);
    });

    it('marks all notifications as read', async () => {
      await notificationsService.create({ userId: member.id, type: 'security_alert', title: 'One' });
      await notificationsService.create({ userId: member.id, type: 'security_alert', title: 'Two' });

      await request(server).patch('/api/v1/notifications/read-all').set('Cookie', memberCookie).expect(200);

      const res = await request(server).get('/api/v1/notifications/unread-count').set('Cookie', memberCookie).expect(200);
      expect(res.body.count).toBe(0);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).get('/api/v1/notifications').expect(401);
    });
  });
});

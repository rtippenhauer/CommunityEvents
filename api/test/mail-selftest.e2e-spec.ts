import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { cities as City, users as User } from '@prisma/client';
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { TEST_TENANT_ID } from './setup-env';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { BrevoService } from '../src/modules/email/brevo.service';
import { EmailService } from '../src/modules/email/email.service';
import { MailSelfTestService } from '../src/modules/email/mail-selftest.service';
import { runUnscoped, runWithTenant } from '../src/common/tenant/tenant-store';
import {
  InboundEmailOutcome,
  MailSelfTestState,
  RsvpStatus,
  UserRole,
} from '../src/database/enums';
import { parseSelftestUid } from '../src/common/utils/ics.util';

const CLOUDFLARE_SECRET = 'test-cloudflare-email-secret-not-for-real-use';

const inTenant = <T>(tenantId: number, fn: () => Promise<T>): Promise<T> =>
  runWithTenant(tenantId, async () => await fn());
const unscoped = <T>(fn: () => Promise<T>): Promise<T> =>
  runUnscoped('test: read every community', async () => await fn());

interface SentMessage {
  toEmail: string;
  subject: string;
  attachments?: { content: string; name: string }[];
}

/**
 * The mail-chain self-test (v2-48), which is what makes the DinnerBears
 * cutover possible: *"I will not cut over to dinnerbears until we can validate
 * email without testing in prod"* (Rob, 2026-11-14).
 *
 * Every email defect so far was found in production, by a member. A community's
 * mail chain has five independent legs and the only thing that exercised any of
 * them was a real event mailing real members — so this suite is mostly about the
 * two things that must be true for the test to be worth trusting: that it cannot
 * be aimed at anybody but the operator, and that a reply moves the state without
 * touching a single row of event data.
 */
describe('Mail-chain self-test (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let selfTest: MailSelfTestService;
  let emailService: EmailService;
  let server: Parameters<typeof request>[0];
  let city: City;
  let admin: User;
  let adminCookie: string;
  let sent: SentMessage[];
  /** Set by a test that wants the provider call to blow up. */
  let sendError: Error | null;
  /** Whether this community has sending credentials, as BrevoService sees it. */
  let configured: boolean;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    selfTest = app.get(MailSelfTestService);
    emailService = app.get(EmailService);
    server = app.getHttpServer();

    // The provider is stubbed. These tests are about what the deployment writes
    // down and what it refuses to do, not about Brevo -- and leaving the real
    // client in place would mean the send failed and `sendNowOrThrow` reported
    // a failure for every case, which would make a broken test pass.
    const brevo = app.get(BrevoService);
    (
      brevo as unknown as { send: (dto: SentMessage) => Promise<{ messageId: string | null }> }
    ).send = async (dto) => {
      if (sendError) throw sendError;
      sent.push(dto);
      return { messageId: `brevo-msg-${sent.length}` };
    };
    (brevo as unknown as { invalidateAccountQuota: () => Promise<void> }).invalidateAccountQuota =
      async () => {};
    // The test tenant has no Brevo key, and the self-test now refuses to run
    // without one -- so this stands in for a configured community. The one test
    // that cares flips it back.
    (brevo as unknown as { isConfigured: () => Promise<boolean> }).isConfigured = async () =>
      configured;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    resetThrottler(app);
    sent = [];
    sendError = null;
    configured = true;
    city = await seedCity(prisma);
    admin = await inTenant(TEST_TENANT_ID, () =>
      seedUser(prisma, city.id, {
        email: 'the-admin@example.test',
        fullName: 'The Admin',
        role: UserRole.ADMIN,
      }),
    );
    adminCookie = await loginAs(app, admin);
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  const run = (body?: unknown) =>
    request(server)
      .post('/api/v1/admin/email/selftest')
      .set('Cookie', adminCookie)
      .send(body ?? {});

  const configRow = () =>
    inTenant(TEST_TENANT_ID, async () => await prisma.email_provider_config.findFirst());

  /** The nonce out of the invite the stub captured, which is what a reply carries. */
  function sentNonce(): string {
    const ics = sent.at(-1)?.attachments?.[0]?.content ?? '';
    const nonce = parseSelftestUid(ics);
    if (!nonce) throw new Error(`No self-test UID in the attachment:\n${ics}`);
    return nonce;
  }

  /** A reply as a mail client sends one, around whichever UID is given. */
  function reply(uid: string, partstat: string): string {
    return [
      'From: The Admin <the-admin@example.test>',
      'To: calendar@communityeventsproject.com',
      `Subject: ${partstat}: setup check`,
      'Content-Type: text/calendar; charset="UTF-8"; method=REPLY',
      '',
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'METHOD:REPLY',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `ATTENDEE;PARTSTAT=${partstat};CN=The Admin:mailto:the-admin@example.test`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
  }

  const postReply = (raw: string) =>
    request(server)
      .post('/api/v1/calendar/rsvp-reply')
      .set('X-Cloudflare-Secret', CLOUDFLARE_SECRET)
      .send({ raw })
      .expect(200);

  const inboundRows = () =>
    unscoped(async () => await prisma.inbound_emails.findMany({ orderBy: { id: 'asc' } }));

  // ── Sending ───────────────────────────────────────────────────────────────

  it('sends one real invite to the acting admin and records it as sent', async () => {
    const res = await run().expect(200);

    expect(sent).toHaveLength(1);
    expect(sent[0].toEmail).toBe('the-admin@example.test');
    expect(res.body.selftestState).toBe(MailSelfTestState.SENT);
    expect(res.body.selftestEmail).toBe('the-admin@example.test');

    const row = await configRow();
    expect(row?.selftestState).toBe(MailSelfTestState.SENT);
    expect(row?.selftestNonce).toMatch(/^[0-9a-f]{16}$/);
    expect(row?.selftestSentAt).toBeInstanceOf(Date);
    expect(row?.selftestProvider).toBe('brevo');
    expect(row?.selftestReplyCount).toBe(0);
    expect(row?.selftestError).toBeNull();
  });

  it('creates the config row for a community that has never configured email', async () => {
    // The self-test is exactly what an operator reaches for while setting mail
    // up, so depending on the row already existing would mean the first run
    // silently did nothing.
    expect(await configRow()).toBeNull();
    await run().expect(200);
    expect((await configRow())?.selftestState).toBe(MailSelfTestState.SENT);
  });

  it('cannot be aimed: an address in the body is ignored', async () => {
    // The guarantee that keeps this a diagnostic rather than a send tool. The
    // route has no DTO and reads the address off the session.
    await run({ toEmail: 'victim@example.test', email: 'victim@example.test' }).expect(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].toEmail).toBe('the-admin@example.test');
  });

  it('names the sending domain in the subject and says it is a test', async () => {
    await run().expect(200);
    // A wrong sending host is one of the defects this test exists to catch, and
    // the UID cannot show it -- the UID namespace is the deployment's for every
    // tenant. So it has to be visible here.
    expect(sent[0].subject).toContain('[Test]');
    expect(sent[0].subject).toContain('127.0.0.1');
  });

  it('attaches a METHOD:REQUEST invite starting in an hour and lasting 30 minutes', async () => {
    const before = Date.now();
    await run().expect(200);
    const ics = sent[0].attachments?.[0]?.content ?? '';

    // METHOD:REQUEST is what makes a mail client render Accept / Maybe /
    // Decline at all. A PUBLISH would render a read-only entry and the test
    // could never be replied to.
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).toContain('RSVP=TRUE');
    expect(ics).toContain('mailto:the-admin@example.test');

    const [, start] = ics.match(/DTSTART:(\d{8}T\d{6})Z/) ?? [];
    const [, end] = ics.match(/DTEND:(\d{8}T\d{6})Z/) ?? [];
    const toDate = (s: string) =>
      new Date(
        `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`,
      );
    const startAt = toDate(start).getTime();
    expect(startAt).toBeGreaterThanOrEqual(before + 59 * 60 * 1000);
    expect(startAt).toBeLessThanOrEqual(Date.now() + 61 * 60 * 1000);
    expect(toDate(end).getTime() - startAt).toBe(30 * 60 * 1000);
  });

  it('uses its own UID namespace and never an event id', async () => {
    await run().expect(200);
    const ics = sent[0].attachments?.[0]?.content ?? '';
    expect(ics).toContain(`UID:communityevents-selftest-${sentNonce()}@communityeventsproject.com`);
    expect(ics).not.toMatch(/UID:communityevents-event-/);
  });

  it('refuses a non-admin', async () => {
    const member = await inTenant(TEST_TENANT_ID, () => seedUser(prisma, city.id));
    await request(server)
      .post('/api/v1/admin/email/selftest')
      .set('Cookie', await loginAs(app, member))
      .send({})
      .expect(403);
    expect(sent).toHaveLength(0);
  });

  // ── Loud failures ─────────────────────────────────────────────────────────

  it('fails loudly when the operator’s own address is suppressed', async () => {
    // A real misconfiguration worth surfacing, not a false negative -- and one
    // the immediate send path would not catch, because it deliberately bypasses
    // the suppression list so a password reset still reaches somebody who once
    // bounced. Left alone, the test would sit in `sent` looking like a delivery
    // fault with the provider.
    await inTenant(TEST_TENANT_ID, () =>
      emailService.suppress('the-admin@example.test', 'bounced'),
    );

    const res = await run().expect(400);
    expect(res.body.message).toMatch(/suppress/i);
    expect(sent).toHaveLength(0);

    const row = await configRow();
    expect(row?.selftestState).toBe(MailSelfTestState.FAILED);
    expect(row?.selftestError).toMatch(/suppress/i);
  });

  it('refuses to run at all when no sending credentials resolve', async () => {
    // `BrevoService.send` logs "not configured -- skipping" and returns
    // normally when no key resolves. That is right for ordinary mail and
    // catastrophic here: without this check the test would record `sent` and
    // wait forever for a reply to a message no provider ever saw, which is the
    // exact invisible failure this item exists to end.
    configured = false;

    const res = await run().expect(400);
    expect(res.body.message).toMatch(/credentials/i);
    expect(sent).toHaveLength(0);

    const row = await configRow();
    expect(row?.selftestState).toBe(MailSelfTestState.FAILED);
    expect(row?.selftestNonce).toBeNull();
    expect(row?.selftestError).toMatch(/credentials/i);
  });

  it('records a refused send as failed instead of queueing it quietly', async () => {
    // `sendNow` would fall back to the queue, which is right for a password
    // reset and wrong here: a send that did not happen is the finding.
    sendError = new Error('Brevo API error 401: key is not valid');

    const res = await run().expect(400);
    expect(res.body.message).toContain('401');

    const row = await configRow();
    expect(row?.selftestState).toBe(MailSelfTestState.FAILED);
    expect(row?.selftestError).toContain('401');

    const queued = await unscoped(async () => await prisma.email_queue.findMany());
    expect(queued).toHaveLength(0);
  });

  // ── The reply, which is the whole point ───────────────────────────────────

  it('passes on the reply, and writes no RSVP anywhere', async () => {
    await run().expect(200);
    await postReply(reply(`communityevents-selftest-${sentNonce()}@communityeventsproject.com`, 'ACCEPTED'));

    const row = await configRow();
    expect(row?.selftestState).toBe(MailSelfTestState.PASSED);
    expect(row?.selftestPassedAt).toBeInstanceOf(Date);
    expect(row?.selftestLastReplyStatus).toBe(RsvpStatus.GOING);
    expect(row?.selftestReplyCount).toBe(1);

    // The reason for the separate UID namespace: a test must not be able to
    // appear in an attendee list or a headcount.
    expect(await unscoped(async () => await prisma.event_rsvps.findMany())).toHaveLength(0);

    const log = await inboundRows();
    expect(log).toHaveLength(1);
    expect(log[0].outcome).toBe(InboundEmailOutcome.SELFTEST_REPLY);
    expect(log[0].tenantId).toBe(TEST_TENANT_ID);
    expect(log[0].eventId).toBeNull();
    expect(log[0].rsvpStatus).toBe(RsvpStatus.GOING);
  });

  it('accepts a second reply after passing, so accept-then-decline works', async () => {
    // Rob, 2026-11-14: "We should allow an Accept and then a decline also, so we
    // can remove it from my calendar." Refusing the second reply would bounce
    // the decline and leave the entry stuck on the operator's calendar.
    await run().expect(200);
    const uid = `communityevents-selftest-${sentNonce()}@communityeventsproject.com`;

    await postReply(reply(uid, 'ACCEPTED'));
    const passedAt = (await configRow())?.selftestPassedAt;

    await postReply(reply(uid, 'DECLINED'));
    const row = await configRow();

    expect(row?.selftestState).toBe(MailSelfTestState.PASSED);
    expect(row?.selftestReplyCount).toBe(2);
    expect(row?.selftestLastReplyStatus).toBe(RsvpStatus.NOT_GOING);
    // Set once: the instant it passed is not the instant of the latest reply.
    expect(row?.selftestPassedAt?.getTime()).toBe(passedAt?.getTime());

    const log = await inboundRows();
    expect(log.map((r) => r.outcome)).toEqual([
      InboundEmailOutcome.SELFTEST_REPLY,
      InboundEmailOutcome.SELFTEST_REPLY,
    ]);
    expect(log[1].detail).toContain('2');
  });

  it('passes on a reply whose UID the client folded', async () => {
    // **The stage failure, 2026-11-14.** A real mail client echoed the UID back
    // folded across two lines -- RFC 5545 caps a CONTENT-LINE at 75 octets --
    // and the reply was filed as `unknown_uid`: it had arrived, the whole
    // inbound leg had worked, and the UID simply did not match. The UID is
    // short enough not to fold now AND both parsers unfold for themselves; this
    // asserts the second half, which is the one that does not depend on the
    // first staying true.
    await run().expect(200);
    const nonce = sentNonce();
    const uid = `communityevents-selftest-${nonce}@communityeventsproject.com`;
    const folded = reply(uid, 'ACCEPTED').replace(
      `UID:${uid}`,
      // A CRLF then a single space: the RFC 5545 continuation a client emits.
      ['UID:communityevents-selftest-' + nonce.slice(0, 4), ' ' + nonce.slice(4) + '@communityeventsproject.com'].join(
        '\r\n',
      ),
    );

    await postReply(folded);

    expect((await configRow())?.selftestState).toBe(MailSelfTestState.PASSED);
    expect((await inboundRows()).at(-1)?.outcome).toBe(InboundEmailOutcome.SELFTEST_REPLY);
  });

  it("keeps the invite UID inside RFC 5545's 75-octet line limit", async () => {
    // The other half of the same fix: do not emit a line that needs folding
    // when nothing requires it. A 32-hex nonce made this 88 octets.
    await run().expect(200);
    const ics = sent[0].attachments?.[0]?.content ?? '';
    const uidLine = ics.split(/\r\n/).find((l) => l.startsWith('UID:')) ?? '';
    expect(Buffer.byteLength(uidLine, 'utf8')).toBeLessThanOrEqual(75);
  });

  it('records an unmatched nonce distinctly, and against no community', async () => {
    await postReply(
      reply('communityevents-selftest-ffffffffffffffffffffffffffffffff@communityeventsproject.com', 'ACCEPTED'),
    );

    const log = await inboundRows();
    expect(log).toHaveLength(1);
    // Not `unknown_uid`: this WAS one of ours, and the difference between "a
    // UID we have never issued" and "a self-test whose community is gone" is
    // the difference between a prober and a replaced Brevo key.
    expect(log[0].outcome).toBe(InboundEmailOutcome.SELFTEST_UNKNOWN);
    expect(log[0].tenantId).toBeNull();
  });

  it('does not mistake a real event UID for a self-test', async () => {
    await postReply(reply('communityevents-event-999999@communityeventsproject.com', 'ACCEPTED'));
    const log = await inboundRows();
    expect(log[0].outcome).toBe(InboundEmailOutcome.EVENT_NOT_FOUND);
  });

  // ── The optional delivered waypoint ───────────────────────────────────────

  it('moves sent → delivered on a provider callback, and never walks back from passed', async () => {
    await run().expect(200);
    const messageId = (await configRow())?.selftestMessageId;
    expect(messageId).toBeTruthy();

    await selfTest.recordDelivered(messageId!);
    expect((await configRow())?.selftestState).toBe(MailSelfTestState.DELIVERED);

    await postReply(reply(`communityevents-selftest-${sentNonce()}@communityeventsproject.com`, 'ACCEPTED'));
    expect((await configRow())?.selftestState).toBe(MailSelfTestState.PASSED);

    // Brevo's callbacks are not ordered, so a late `delivered` must not undo a
    // pass. `delivered` is an optional waypoint, not a step.
    await selfTest.recordDelivered(messageId!);
    expect((await configRow())?.selftestState).toBe(MailSelfTestState.PASSED);
  });

  // ── Reset on a key change ─────────────────────────────────────────────────

  it('resets to never_run when the Brevo key changes', async () => {
    await run().expect(200);
    await postReply(reply(`communityevents-selftest-${sentNonce()}@communityeventsproject.com`, 'ACCEPTED'));
    expect((await configRow())?.selftestState).toBe(MailSelfTestState.PASSED);

    await request(server)
      .patch('/api/v1/admin/email/config')
      .set('Cookie', adminCookie)
      .send({ brevoApiKey: 'xkeysib-a-different-account-entirely' })
      .expect(200);

    // A passing test against a replaced key is a lie: the new key may belong to
    // a different Brevo account, with its own sender verification and its own
    // template library.
    const row = await configRow();
    expect(row?.selftestState).toBe(MailSelfTestState.NEVER_RUN);
    expect(row?.selftestNonce).toBeNull();
    expect(row?.selftestPassedAt).toBeNull();
    expect(row?.selftestReplyCount).toBe(0);
  });

  it('files a reply to the pre-change invite as unknown rather than re-passing', async () => {
    await run().expect(200);
    const uid = `communityevents-selftest-${sentNonce()}@communityeventsproject.com`;

    await request(server)
      .patch('/api/v1/admin/email/config')
      .set('Cookie', adminCookie)
      .send({ brevoApiKey: 'xkeysib-a-different-account-entirely' })
      .expect(200);

    await postReply(reply(uid, 'ACCEPTED'));

    expect((await configRow())?.selftestState).toBe(MailSelfTestState.NEVER_RUN);
    expect((await inboundRows()).at(-1)?.outcome).toBe(InboundEmailOutcome.SELFTEST_UNKNOWN);
  });

  // ── The nonce is not a credential, and is not published ───────────────────

  it('never returns the nonce over HTTP', async () => {
    await run().expect(200);
    const res = await request(server)
      .get('/api/v1/admin/email/config')
      .set('Cookie', adminCookie)
      .expect(200);

    expect(res.body.selftestState).toBe(MailSelfTestState.SENT);
    expect(res.body).not.toHaveProperty('selftestNonce');
    expect(JSON.stringify(res.body)).not.toContain((await configRow())!.selftestNonce!);
  });
});

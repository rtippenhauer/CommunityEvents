import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { EmailService } from '../src/modules/email/email.service';
import { BrevoService } from '../src/modules/email/brevo.service';
import { EmailDispatcherService } from '../src/modules/email/email-dispatcher.service';
import { runUnscoped, runWithTenant } from '../src/common/tenant/tenant-store';
import { createTestApp, truncateAllTables } from './utils/test-app';
import { TEST_TENANT_ID } from './setup-env';

const inTenant = <T>(tenantId: number, fn: () => Promise<T>): Promise<T> =>
  runWithTenant(tenantId, async () => await fn());
const unscoped = <T>(fn: () => Promise<T>): Promise<T> =>
  runUnscoped('inspecting the queue across tenants', async () => await fn());

/**
 * An immediate send is recorded in the email log.
 *
 * `email_queue` is the record of what a community *sent*, not merely of what is
 * waiting to go -- it is what the admin email screen reads. But `sendNow` talks
 * to the provider directly and used to write a row only when the send failed
 * and fell back to the queue, so every successful immediate send was invisible:
 * password resets, address verification, the lockout alert, two event mails and
 * v2-14's demo confirmation.
 *
 * Found by Rob on stage, looking in the log for a demo confirmation that had
 * definitely arrived in his inbox. The same shape as the bug v2-9 fixed one
 * layer over, where `sendNow` bypassed the daily counter -- the counter was
 * fixed then and the log was not.
 */
describe('Immediate sends are logged (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let email: EmailService;
  let sent: { toEmail: string; subject: string }[];

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    email = app.get(EmailService);

    // The provider is stubbed: these tests are about what we write down, not
    // about Brevo. Without this, sendNow's failure path would fire and the
    // fallback would queue a PENDING row -- which would make a broken test look
    // like a passing one, since a row would exist either way.
    sent = [];
    const brevo = app.get(BrevoService);
    (brevo as unknown as { send: (dto: { toEmail: string; subject: string }) => Promise<void> }).send =
      async (dto) => {
        sent.push({ toEmail: dto.toEmail, subject: dto.subject });
      };
    (brevo as unknown as { invalidateAccountQuota: () => Promise<void> }).invalidateAccountQuota =
      async () => {};
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    sent = [];
  });

  const send = () =>
    inTenant(TEST_TENANT_ID, () =>
      email.sendNow({
        toEmail: 'member@example.test',
        subject: 'Reset your password',
        htmlBody: '<p>here</p>',
      }),
    );

  it('writes a row for a send that bypassed the queue', async () => {
    await send();

    // It really went, and it was really recorded -- both, because either alone
    // is the bug.
    expect(sent).toHaveLength(1);
    const rows = await unscoped(() => prisma.email_queue.findMany());
    expect(rows).toHaveLength(1);
    expect(rows[0].toEmail).toBe('member@example.test');
    expect(rows[0].subject).toBe('Reset your password');
    expect(rows[0].status).toBe('sent');
    expect(rows[0].sentAt).not.toBeNull();
  });

  it('files it against the community that sent it', async () => {
    await send();
    const rows = await unscoped(() => prisma.email_queue.findMany());
    expect(rows[0].tenantId).toBe(TEST_TENANT_ID);
  });

  /**
   * The property that makes this safe. A logged send must be history, not work:
   * if the dispatcher picked these up, every password reset would be delivered
   * twice.
   */
  it('is not picked up and sent again by the dispatcher', async () => {
    await send();
    expect(sent).toHaveLength(1);

    await app.get(EmailDispatcherService).dispatchPending();

    expect(sent).toHaveLength(1);
    const rows = await unscoped(() => prisma.email_queue.findMany());
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('sent');
  });

  // The failure path is unchanged: a send the provider rejects still lands as
  // PENDING work for the dispatcher to retry, not as a `sent` record of
  // something that never went.
  it('still queues a failed send as pending rather than logging it as sent', async () => {
    const brevo = app.get(BrevoService);
    (brevo as unknown as { send: () => Promise<void> }).send = async () => {
      throw new Error('provider down');
    };

    await send();

    const rows = await unscoped(() => prisma.email_queue.findMany());
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');

    (brevo as unknown as { send: (dto: { toEmail: string; subject: string }) => Promise<void> }).send =
      async (dto) => {
        sent.push({ toEmail: dto.toEmail, subject: dto.subject });
      };
  });
});

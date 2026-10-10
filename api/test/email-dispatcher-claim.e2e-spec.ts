import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { EmailService } from '../src/modules/email/email.service';
import { BrevoService } from '../src/modules/email/brevo.service';
import { EmailDispatcherService } from '../src/modules/email/email-dispatcher.service';
import { EmailQueueStatus } from '../src/database/enums';
import { runUnscoped } from '../src/common/tenant/tenant-store';
import { createTestApp, truncateAllTables } from './utils/test-app';

/** Reads and writes the queue directly, which inspecting a claim requires. */
const unscoped = <T>(fn: () => Promise<T>): Promise<T> =>
  runUnscoped('inspecting the email queue across tenants', async () => await fn());

const MAX_ATTEMPTS = 3;

/**
 * The dispatcher claims a row before sending it.
 *
 * `email_queue` had no in-flight state: `dispatchPending` selected `pending`,
 * sent, and only then wrote the outcome. That is safe while exactly one
 * dispatcher runs and **that was already not true** -- Admin -> Send Now calls
 * `dispatchPending` from a request, so an admin pressing it while the cron was
 * mid-run could hand the same message to Brevo twice. Latent only because the
 * overlap had to be timed to the second, and a go-live blocker the moment real
 * members receive real mail.
 *
 * Carved out of v2-27 ("one way to send an email") and done first, because the
 * claim is a prerequisite for unifying the two send paths and fixes a live
 * hazard on its own.
 *
 * Every test here runs against real MySQL rather than a mocked client, which is
 * the whole point: the claim is a conditional UPDATE and what makes it work is
 * the row lock the database takes. A fake client would serialise the two
 * dispatchers in JavaScript and pass whatever the query said.
 */
describe('Email dispatcher claim (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let email: EmailService;
  let dispatcher: EmailDispatcherService;

  /** Every address the provider was asked to mail, in order, duplicates kept. */
  let sent: string[];
  /** Milliseconds each stubbed send takes, so a race can be widened. */
  let sendDelayMs: number;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    email = app.get(EmailService);
    dispatcher = app.get(EmailDispatcherService);

    const brevo = app.get(BrevoService);
    // The provider is stubbed because these tests are about which rows are
    // handed to it, not about Brevo. `isConfigured` has to be forced true: the
    // test env deliberately carries no BREVO_API_KEY, and with no configured
    // provider every row would settle as BLOCKED -- so a broken claim would
    // look like a passing test, nothing having been sent either way.
    const stub = brevo as unknown as {
      send: (dto: { toEmail: string }) => Promise<void>;
      isConfigured: () => Promise<boolean>;
      getAccountQuota: () => Promise<null>;
      invalidateAccountQuota: () => Promise<void>;
    };
    stub.isConfigured = async () => true;
    // null means "no daily cap to hold anything against", the permissive
    // branch. The account budget is not what is under test here.
    stub.getAccountQuota = async () => null;
    stub.invalidateAccountQuota = async () => {};
    stub.send = async (dto) => {
      // Recorded *before* the delay, so a duplicate is caught even while the
      // second send is still in flight.
      sent.push(dto.toEmail);
      if (sendDelayMs > 0) await new Promise((r) => setTimeout(r, sendDelayMs));
    };
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    sent = [];
    sendDelayMs = 0;
  });

  const queue = (toEmail: string) =>
    email.queue({ toEmail, subject: `To ${toEmail}`, htmlBody: '<p>hello</p>' });

  const rows = () => unscoped(() => prisma.email_queue.findMany({ orderBy: { id: 'asc' } }));

  /** Puts a row into the state a dispatcher that died mid-send would leave. */
  const forceClaimed = (id: number, claimedAt: Date, attempts = 0) =>
    unscoped(() =>
      prisma.email_queue.updateMany({
        where: { id },
        data: { status: EmailQueueStatus.SENDING, claimedAt, attempts },
      }),
    );

  const minutesAgo = (n: number) => new Date(Date.now() - n * 60 * 1000);

  describe('two dispatchers at once', () => {
    /**
     * The defect, reproduced. This is the test the fix exists for: before the
     * claim, both dispatchers read the same `pending` batch and each sent every
     * row in it, so twelve queued messages became twenty-four sends and every
     * member on the list was mailed twice.
     */
    it('sends each queued message exactly once', async () => {
      const addresses = Array.from({ length: 12 }, (_, i) => `member${i}@example.test`);
      for (const a of addresses) await queue(a);

      // A real send takes long enough for the other dispatcher to get well into
      // its own batch; an instant stub would let each run to completion before
      // the other began, and the race would never be attempted.
      sendDelayMs = 5;

      await Promise.all([dispatcher.dispatchPending(), dispatcher.dispatchPending()]);

      expect(sent).toHaveLength(addresses.length);
      expect([...sent].sort()).toEqual([...addresses].sort());
      // Stated separately from the length, because a count can be right while
      // the set is wrong: one message sent twice and another never.
      expect(new Set(sent).size).toBe(addresses.length);

      const after = await rows();
      expect(after).toHaveLength(addresses.length);
      expect(after.every((r) => r.status === EmailQueueStatus.SENT)).toBe(true);
      // One attempt each. Two would mean both dispatchers wrote an outcome for
      // the same row -- the same bug surviving in the bookkeeping.
      expect(after.every((r) => r.attempts === 1)).toBe(true);
    });

    /**
     * The same property under the arrangement that actually happens in
     * production: the five-minute cron sweeping every community while an admin
     * presses Send Now, which runs inside their own request and so is scoped to
     * their community alone.
     */
    it('holds when a scoped flush overlaps the unscoped cron', async () => {
      for (let i = 0; i < 8; i += 1) await queue(`overlap${i}@example.test`);
      sendDelayMs = 5;

      await Promise.all([
        runUnscoped('the cron drains every tenant', () => dispatcher.dispatchPending()),
        dispatcher.dispatchPending(),
      ]);

      expect(sent).toHaveLength(8);
      expect(new Set(sent).size).toBe(8);
    });

    /** Three, so that "exactly one wins" is not a property of there being two. */
    it('holds with three dispatchers', async () => {
      for (let i = 0; i < 10; i += 1) await queue(`three${i}@example.test`);
      sendDelayMs = 3;

      await Promise.all([
        dispatcher.dispatchPending(),
        dispatcher.dispatchPending(),
        dispatcher.dispatchPending(),
      ]);

      expect(sent).toHaveLength(10);
      expect(new Set(sent).size).toBe(10);
    });
  });

  describe('a row somebody else is sending', () => {
    it('is left alone', async () => {
      const row = await queue('inflight@example.test');
      await forceClaimed(row!.id, new Date());

      await dispatcher.dispatchPending();

      expect(sent).toHaveLength(0);
      const [after] = await rows();
      // Untouched, including the claim: the other dispatcher still owns this
      // row and is going to write the outcome itself.
      expect(after.status).toBe(EmailQueueStatus.SENDING);
      expect(after.claimedAt).not.toBeNull();
      expect(after.attempts).toBe(0);
    });
  });

  describe('a claim nobody is holding', () => {
    /**
     * The state a container recreate, an OOM or a deploy mid-batch leaves
     * behind. Without a way out of `sending` the message would sit there
     * permanently, since every run selects `pending` only -- which would trade
     * a double-send hazard for a silent-loss one rather than fixing anything.
     */
    it('goes back on the queue and sends', async () => {
      const row = await queue('abandoned@example.test');
      await forceClaimed(row!.id, minutesAgo(30));

      await dispatcher.dispatchPending();

      expect(sent).toEqual(['abandoned@example.test']);
      const [after] = await rows();
      expect(after.status).toBe(EmailQueueStatus.SENT);
      expect(after.claimedAt).toBeNull();
      // Two: the sweep counts the attempt that died, and the send that followed
      // counts its own. Counting the abandoned one is what stops a message that
      // reliably kills the dispatcher from being retried forever.
      expect(after.attempts).toBe(2);
    });

    it('is not touched before the window has passed', async () => {
      const row = await queue('recent@example.test');
      await forceClaimed(row!.id, minutesAgo(2));

      await dispatcher.dispatchPending();

      expect(sent).toHaveLength(0);
      const [after] = await rows();
      expect(after.status).toBe(EmailQueueStatus.SENDING);
    });

    /**
     * The bound. A message whose send kills the process would otherwise be
     * reclaimed, re-sent and kill it again on every run, forever.
     */
    it('settles as failed once it is out of attempts', async () => {
      const row = await queue('exhausted@example.test');
      await forceClaimed(row!.id, minutesAgo(30), MAX_ATTEMPTS - 1);

      await dispatcher.dispatchPending();

      expect(sent).toHaveLength(0);
      const [after] = await rows();
      expect(after.status).toBe(EmailQueueStatus.FAILED);
      expect(after.attempts).toBe(MAX_ATTEMPTS);
      expect(after.claimedAt).toBeNull();
      expect(after.errorMessage).toContain('ran out of attempts');
    });
  });

  describe('the claim is given up on every outcome', () => {
    /**
     * `claimed_at IS NOT NULL` has to mean "somebody is sending this right
     * now", because that is what the sweep reads the column for. A terminal row
     * still carrying a claim is a row the sweep might reason about.
     */
    it('clears claimedAt on a successful send', async () => {
      await queue('clears@example.test');
      await dispatcher.dispatchPending();

      const [after] = await rows();
      expect(after.status).toBe(EmailQueueStatus.SENT);
      expect(after.claimedAt).toBeNull();
    });

    it('clears claimedAt on a send the provider rejected', async () => {
      const brevo = app.get(BrevoService);
      const working = (brevo as unknown as { send: unknown }).send;
      (brevo as unknown as { send: () => Promise<void> }).send = async () => {
        throw new Error('provider down');
      };

      await queue('rejected@example.test');
      await dispatcher.dispatchPending();

      const [after] = await rows();
      // Back to pending for a retry, as before this change -- and with no claim
      // on it, or the next run would skip it and only the sweep could free it.
      expect(after.status).toBe(EmailQueueStatus.PENDING);
      expect(after.claimedAt).toBeNull();
      expect(after.attempts).toBe(1);

      (brevo as unknown as { send: unknown }).send = working;
    });
  });

  describe('cancelling', () => {
    /**
     * Cancelling used to write over whatever the row held. Harmless-looking
     * until the claim existed: a `sending` row has been handed to the provider
     * or is about to be, so recording a cancellation would deny mail that went
     * out -- and the dispatcher's own write would overwrite the cancellation
     * anyway.
     */
    it('refuses a message that is already in flight', async () => {
      const row = await queue('cancelme@example.test');
      await forceClaimed(row!.id, new Date());

      await email.cancelEmail(row!.id);

      const [after] = await rows();
      expect(after.status).toBe(EmailQueueStatus.SENDING);
    });

    it('still cancels one that is only waiting', async () => {
      const row = await queue('waiting@example.test');

      await email.cancelEmail(row!.id);

      const [after] = await rows();
      expect(after.status).toBe(EmailQueueStatus.CANCELLED);

      // And the dispatcher does not pick it back up.
      await dispatcher.dispatchPending();
      expect(sent).toHaveLength(0);
    });
  });
});

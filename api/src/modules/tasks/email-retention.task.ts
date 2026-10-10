import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EmailService } from '../email/email.service';
import { runUnscoped } from '../../common/tenant/tenant-store';

/**
 * Clears the rendered body of old messages from the email log (Rob,
 * 2026-10-03).
 *
 * Nothing pruned `email_queue` before this, so it grew without limit while
 * carrying `html_body` as LongText -- the log is the reason to keep rows, and
 * the body is what makes keeping them expensive.
 *
 * **The row survives; only the body goes.** The envelope is what answers "did
 * this member ever get their invite", and it costs a few hundred bytes. See
 * `EmailService.clearOldBodies` for why deleting rows outright was left out.
 *
 * 04:00 UTC, which is around midnight Eastern -- the opposite reasoning from
 * the demo sweep, which avoids that hour precisely because somebody may be
 * using a demo. Nobody is watching old email bodies disappear, so the quiet
 * hour for the database is the right one.
 */
@Injectable()
export class EmailRetentionTask {
  private readonly logger = new Logger(EmailRetentionTask.name);

  constructor(private readonly emailService: EmailService) {}

  @Cron('0 4 * * *')
  async runEmailRetention(): Promise<void> {
    // Across every community: retention is a property of the deployment's
    // storage, not of any one community's data, and a per-tenant sweep would
    // need to enumerate tenants to do the same work. Awaited inside the
    // callback, never returned from it -- Prisma promises are lazy, so returning
    // one would build the query in the waived context and run it outside.
    const cleared = await runUnscoped(
      'email retention sweeps every community',
      async () => await this.emailService.clearOldBodies(),
    );

    if (cleared > 0) {
      this.logger.log(`Email retention: cleared the body of ${cleared} old message(s).`);
    }
  }
}

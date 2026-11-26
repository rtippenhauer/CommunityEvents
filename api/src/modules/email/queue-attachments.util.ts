import type { Logger } from '@nestjs/common';
import type { EmailAttachment } from './brevo.service';

/**
 * Read `email_queue.attachments` back into the shape the providers take
 * (`v2-50`).
 *
 * **Why this is not a cast.** The column is JSON, so three kinds of value
 * legitimately arrive here: `null` from every row written before the column
 * existed and from every message that has no attachment, a well-formed array
 * from `EmailService.queue`, and -- because it is a JSON column in a database
 * an operator can reach -- anything at all. A cast would hand `undefined.name`
 * to the provider payload and throw inside the send, which the dispatcher
 * records as a send failure and retries four more times against a row that can
 * never succeed.
 *
 * So a bad value drops the attachment and keeps the message. That is the right
 * way round: the body is what the member is waiting for, and an invite email
 * without its invite is the failure this item exists to fix -- worth a warning
 * in the log, not worth withholding the mail.
 *
 * Entries are filtered individually rather than all-or-nothing, since nothing
 * ties one attachment's validity to another's.
 */
export function readAttachments(
  value: unknown,
  queueId: number,
  logger?: Pick<Logger, 'warn'>,
): EmailAttachment[] | undefined {
  if (value === null || value === undefined) return undefined;

  if (!Array.isArray(value)) {
    logger?.warn(`Email ${queueId}: attachments is not an array, sending without it`);
    return undefined;
  }

  const kept: EmailAttachment[] = [];
  for (const entry of value) {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as EmailAttachment).content === 'string' &&
      typeof (entry as EmailAttachment).name === 'string'
    ) {
      const { content, name, contentType } = entry as EmailAttachment;
      kept.push({
        content,
        name,
        ...(typeof contentType === 'string' ? { contentType } : {}),
      });
    } else {
      logger?.warn(`Email ${queueId}: dropping a malformed attachment entry`);
    }
  }

  // An array that held nothing usable is reported as no attachments, not as an
  // empty list -- the providers branch on `attachments?.length` and an empty
  // array would read as "deliberately none", which is the same outcome by a
  // less honest route.
  return kept.length > 0 ? kept : undefined;
}

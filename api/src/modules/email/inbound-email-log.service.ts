import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { runUnscoped } from '../../common/tenant/tenant-store';
import { InboundEmailOutcome } from '../../database/enums';
import { decodeEncodedWords } from '../../common/utils/mime-header.util';
import type { InboundEmailLogQueryDto } from './dto/inbound-email-log-query.dto';

/** Outcomes that mean we understood the message and acted (or correctly did not). */
const SUCCESS_OUTCOMES: readonly string[] = [
  InboundEmailOutcome.RECORDED,
  InboundEmailOutcome.UNCHANGED,
];

/**
 * The only outcomes that fold, and the reason the list is this short.
 *
 * **Measured on stage, 2026-10-22, not reasoned about.** Five consecutive
 * messages arrived from five different Cloudflare addresses -- 198.41.227.70,
 * 104.22.191.63, 172.71.167.42, 172.70.94.90, 172.71.167.42 -- because a Worker
 * egresses from whichever edge node ran it. So a fold keyed on the source
 * address can never collapse Worker-delivered mail, and the first draft of this
 * list, which folded every failure, was ineffective for the one caller that
 * actually exists.
 *
 * That turns out to be the right behaviour anyway, which is why this is a
 * narrowed list rather than a different key. **A parse failure is about one
 * member's message** -- `no_ical` from two different people proposing two
 * different times are two things an operator wants to see, and collapsing them
 * into "+1 more" would hide the second member entirely. What needs bounding is
 * the unauthenticated surface: a prober hitting the endpoint has a stable
 * address and no legitimate reason to be counted twice.
 *
 * (The same measurement is why blocking by IP was refused: Cloudflare's egress
 * addresses are shared and rotating, so a block would miss the prober and
 * eventually catch our own mail path.)
 */
/**
 * **Folded on the outcome alone, never on the source address.**
 *
 * The first version keyed on `${sourceIp}|${outcome}`, which was wrong twice
 * over. It could not collapse Worker-delivered mail at all, since Cloudflare
 * egresses from a different edge node per invocation (five consecutive stage
 * messages, five addresses). And for the case it *was* for -- an anonymous
 * caller hammering the endpoint -- it made the bound depend on a value the
 * caller influences: rotate the source, or spoof `CF-Connecting-IP` on a
 * deployment not behind Cloudflare, and every request opens its own row. A
 * bound an attacker can widen is not a bound.
 *
 * Keyed on the outcome, at most three rows per window exist however many
 * sources are involved. The cost is that two simultaneous probers share a row;
 * the counter still shows the volume, and the first row keeps an address.
 */
const FOLDABLE_OUTCOMES: readonly string[] = [
  InboundEmailOutcome.INVALID_SECRET,
  InboundEmailOutcome.MALFORMED_REQUEST,
  InboundEmailOutcome.RATE_LIMITED,
];

/**
 * How long one source's repeated identical failure folds into a single row.
 * 30 minutes, matching `ThrottlerAuditGuard`'s window for the same reason: it
 * is long enough that a loop cannot fill the table, short enough that a
 * recurring fault still shows up as separate incidents over a day.
 */
const SUPPRESSION_WINDOW_MS = 30 * 60 * 1000;

/** Hard ceiling on what we keep of one message, so a 25MiB email is not a 25MiB row. */
const MAX_STORED_BODY_BYTES = 256 * 1024;

export interface RecordInboundInput {
  outcome: string;
  /**
   * The community this message turned out to belong to, or null for "none".
   * Null is not a failure of this function -- it is the most important row on
   * the screen, and the reason the table is global.
   */
  tenantId?: number | null;
  detail?: string | null;
  eventId?: number | null;
  userId?: number | null;
  rsvpStatus?: string | null;
  /** The raw message, when we are willing to keep it. See `storeBody`. */
  raw?: string | null;
  /**
   * False for a request that failed authentication: that body is
   * attacker-supplied content arriving on an unauthenticated endpoint, so its
   * size and source are recorded and its content is not.
   */
  storeBody?: boolean;
  sizeBytes: number;
  /**
   * A label on the row, and nothing that depends on being true -- resolve it
   * with `clientIpFrom`, which explains why. It stopped being the fold key on
   * 2026-10-22, because a bound keyed on a value the caller influences is not
   * a bound.
   */
  sourceIp?: string | null;
}

export interface InboundEmailRow {
  id: number;
  tenantId: number | null;
  tenantName: string | null;
  outcome: string;
  detail: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  subject: string | null;
  eventId: number | null;
  userId: number | null;
  rsvpStatus: string | null;
  sizeBytes: number;
  sourceIp: string | null;
  suppressedCount: number;
  hasBody: boolean;
  receivedAt: Date;
}

export interface InboundEmailPage {
  rows: InboundEmailRow[];
  total: number;
  page: number;
  limit: number;
  byOutcome: Record<string, number>;
}

/**
 * The inbound mail log (v2-34): one place that writes it, two ways to read it.
 *
 * ## Why every write goes through here
 *
 * `processRsvpReply` had thirteen places it could stop and every one was a
 * `logger.warn` and a bare `return`. Rob's call (2026-10-20) was that all of
 * them land in one place rather than being sprinkled across a pipe, a guard and
 * a service -- so the service returns an outcome, the controller records it, and
 * this class is the only thing that touches the table. Adding an exit to the
 * parser is then a new enum value and nothing else.
 *
 * ## Why the reads are two separate methods
 *
 * `inbound_emails` is a **global** model, so the tenant-scoping extension
 * injects nothing: a read with no predicate returns every community's mail.
 * That is exactly right for the operator and catastrophic for anyone else, and
 * the difference cannot be left to a caller remembering a filter.
 *
 * So `listForTenant` takes the tenant id as a required positional argument --
 * it cannot be called without one, and passing the wrong type does not compile
 * -- while `listAll` says in its name that it crosses communities. There is no
 * single `list(filterMaybe?)` that could be called either way by accident.
 */
@Injectable()
export class InboundEmailLogService {
  private readonly logger = new Logger(InboundEmailLogService.name);

  /**
   * `source|outcome` -> the row that is absorbing repeats, and when it started.
   *
   * In memory, like `ThrottlerAuditGuard`'s equivalent, with the same
   * consequences stated rather than discovered: it resets on restart and is not
   * shared between containers, so one source can open a fresh row per container
   * per restart. Acceptable for a log whose job is to be noticed.
   */
  private readonly suppression = new Map<string, { rowId: number; since: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Write one row, or fold this failure into a recent identical one.
   *
   * **Never throws.** Every caller is on the inbound path, and a log that can
   * fail a request would turn a diagnostic into an outage -- the opposite of
   * the point. A failure here is logged and swallowed.
   */
  async record(input: RecordInboundInput): Promise<void> {
    try {
      const folded = await this.foldIntoRecent(input);
      if (folded) return;

      const envelope = this.parseEnvelope(input.raw ?? null);
      const body = input.storeBody === false ? null : this.truncateBody(input.raw ?? null);

      // runUnscoped because this table is global and the write happens outside
      // any tenant context on most paths -- and because the row whose tenant is
      // null is the one that matters most, it must not need a context at all.
      const row = await runUnscoped('inbound mail log: a global record of what arrived', () =>
        this.prisma.inbound_emails.create({
          data: {
            tenantId: input.tenantId ?? null,
            outcome: input.outcome as never,
            detail: input.detail?.slice(0, 500) ?? null,
            fromAddress: envelope.from,
            toAddress: envelope.to,
            subject: envelope.subject,
            eventId: input.eventId ?? null,
            userId: input.userId ?? null,
            rsvpStatus: input.rsvpStatus ?? null,
            rawBody: body,
            sizeBytes: input.sizeBytes,
            sourceIp: input.sourceIp ?? null,
          },
          select: { id: true },
        }),
      );

      if (FOLDABLE_OUTCOMES.includes(input.outcome)) {
        this.suppression.set(this.suppressionKey(input), { rowId: row.id, since: Date.now() });
      }
    } catch (err) {
      this.logger.error(`inbound log: could not record a ${input.outcome} row`, err as Error);
    }
  }

  /**
   * One community's own inbound mail. **Cannot be called without a tenant.**
   *
   * The `tenantId` predicate is applied here and not by the extension, because
   * this model is global -- see the class comment. A community never sees a row
   * whose tenant is null either: a message that matched no community may name a
   * *different* community's address, which is the customer list v2-32 is
   * careful never to disclose.
   */
  async listForTenant(tenantId: number, query: InboundEmailLogQueryDto): Promise<InboundEmailPage> {
    return this.list({ ...this.filters(query), tenantId }, query, false);
  }

  /**
   * Every row, including the ones belonging to no community.
   *
   * No tenant predicate, deliberately: "every row" is literal, and the
   * tenantless rows are the point of this view rather than an exception to it.
   * A message that resolved to nothing is both the most valuable row on the
   * screen and the only row `listForTenant` can never return, so a filter here
   * would leave the log blind exactly where it was built to see.
   */
  async listAll(query: InboundEmailLogQueryDto): Promise<InboundEmailPage> {
    const where = this.filters(query);
    if (query.tenantId !== undefined) where.tenantId = query.tenantId;
    if (query.unresolvedOnly) where.tenantId = null;
    return this.list(where, query, true);
  }

  private async list(
    where: Prisma.inbound_emailsWhereInput,
    query: InboundEmailLogQueryDto,
    namesTenants: boolean,
  ): Promise<InboundEmailPage> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    return runUnscoped('inbound mail log: a global table, filtered by hand', async () => {
      const [rows, total, grouped] = await Promise.all([
        this.prisma.inbound_emails.findMany({
          where,
          // The `id` tiebreaker stays even though received_at is DATETIME(3):
          // a retrying mail server can deliver several messages inside one
          // millisecond, and an unstable order under OFFSET/LIMIT repeats one
          // row across pages while skipping another. Three bugs of this exact
          // shape have already shipped here (v2-31, and twice in v2-33).
          orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            tenantId: true,
            outcome: true,
            detail: true,
            fromAddress: true,
            toAddress: true,
            subject: true,
            eventId: true,
            userId: true,
            rsvpStatus: true,
            sizeBytes: true,
            sourceIp: true,
            suppressedCount: true,
            receivedAt: true,
            // Whether a body was kept, never the body itself: it is LongText,
            // and sending it with every row would make the response grow with
            // the deployment's mail rather than with the page (v2-31's lesson).
            rawBody: false,
            // The community's name, for the operator's view only.
            tenant: namesTenants ? { select: { slug: true } } : false,
          },
        }),
        this.prisma.inbound_emails.count({ where }),
        this.prisma.inbound_emails.groupBy({ by: ['outcome'], where, _count: { _all: true } }),
      ]);

      const byOutcome: Record<string, number> = {};
      for (const g of grouped) byOutcome[g.outcome] = g._count._all;

      return {
        rows: rows.map((r) => ({
          id: r.id,
          tenantId: r.tenantId,
          tenantName: namesTenants ? ((r as { tenant?: { slug: string } }).tenant?.slug ?? null) : null,
          outcome: r.outcome,
          detail: r.detail,
          fromAddress: r.fromAddress,
          toAddress: r.toAddress,
          subject: r.subject,
          eventId: r.eventId,
          userId: r.userId,
          rsvpStatus: r.rsvpStatus,
          sizeBytes: r.sizeBytes,
          sourceIp: namesTenants ? r.sourceIp : null,
          suppressedCount: r.suppressedCount,
          hasBody: false,
          receivedAt: r.receivedAt,
        })),
        total,
        page,
        limit,
        byOutcome,
      };
    });
  }

  /**
   * The stored message, for one row.
   *
   * Takes the tenant id for a community's read exactly as the list does, so the
   * detail view cannot be the hole in the isolation the list closed. The
   * operator passes null, which is what lets them open a tenantless row.
   */
  async getBody(id: number, tenantId: number | null): Promise<{ raw: string | null } | null> {
    return runUnscoped('inbound mail log: one message, filtered by hand', async () => {
      const where: Prisma.inbound_emailsWhereInput = { id };
      if (tenantId !== null) where.tenantId = tenantId;
      const row = await this.prisma.inbound_emails.findFirst({
        where,
        select: { rawBody: true },
      });
      if (!row) return null;
      return { raw: row.rawBody };
    });
  }

  private filters(query: InboundEmailLogQueryDto): Prisma.inbound_emailsWhereInput {
    const where: Prisma.inbound_emailsWhereInput = {};
    if (query.outcome) where.outcome = query.outcome as never;
    if (query.failuresOnly) where.outcome = { notIn: SUCCESS_OUTCOMES as never };
    if (query.q) {
      where.OR = [
        { fromAddress: { contains: query.q } },
        { toAddress: { contains: query.q } },
        { subject: { contains: query.q } },
      ];
    }
    if (query.from || query.to) {
      where.receivedAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    return where;
  }

  /**
   * Bump a recent identical failure instead of writing a new row.
   *
   * The log has to stay bounded against an anonymous caller, and it must not go
   * *quiet* to do it: a counter that climbs is visible on the screen, where a
   * row that was never written is not. So repeats are folded, never dropped.
   *
   * Only `FOLDABLE_OUTCOMES` fold -- see that list for why it is three values
   * and not "every failure", and why the key is the outcome rather than the
   * caller. A parse failure is about one member's message and is never
   * collapsed: "did this member's reply arrive" is a question about one
   * message, and answering it with a count would defeat the log.
   */
  private async foldIntoRecent(input: RecordInboundInput): Promise<boolean> {
    if (!FOLDABLE_OUTCOMES.includes(input.outcome)) return false;

    const key = this.suppressionKey(input);
    const seen = this.suppression.get(key);
    if (!seen || Date.now() - seen.since > SUPPRESSION_WINDOW_MS) return false;

    const updated = await runUnscoped('inbound mail log: folding a repeat', () =>
      this.prisma.inbound_emails.updateMany({
        where: { id: seen.rowId },
        data: { suppressedCount: { increment: 1 } },
      }),
    );
    // updateMany, not update: the row can have been deleted between requests,
    // and update() throws P2025 when it is gone -- four separate regressions in
    // this codebase have come from exactly that. A count of zero means the row
    // went away, so stop folding into it.
    if (updated.count === 0) {
      this.suppression.delete(key);
      return false;
    }
    return true;
  }

  private suppressionKey(input: RecordInboundInput): string {
    // The outcome, and deliberately not the source -- see FOLDABLE_OUTCOMES.
    return input.outcome;
  }

  /**
   * From/To/Subject off the raw message, for the list to be readable.
   *
   * Header-only and deliberately crude: this is a log, not a mail client. RFC
   * 5322 folded headers are unfolded first, because a long Subject is wrapped
   * across lines by most senders and a regex that ignores that silently stores
   * half of it.
   */
  private parseEnvelope(raw: string | null): {
    from: string | null;
    to: string | null;
    subject: string | null;
  } {
    if (!raw) return { from: null, to: null, subject: null };
    // Headers end at the first blank line; unfold continuations.
    const headerBlock = raw.split(/\r?\n\r?\n/, 1)[0] ?? '';
    const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, ' ');
    const header = (name: string): string | null => {
      const match = unfolded.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'));
      if (!match) return null;
      // Decoded, because every row on stage showed its subject as
      // `=?UTF-8?Q?Proposed_new_time=3A_...` — a log that displays the raw
      // header is unreadable exactly when the subject matters. Sliced after
      // decoding, so the limit applies to characters a person will read rather
      // than to the escapes.
      return decodeEncodedWords(match[1].trim()).slice(0, 500);
    };
    return { from: header('From'), to: header('To'), subject: header('Subject') };
  }

  /**
   * Keep the start of an oversized message rather than all or nothing.
   *
   * Cloudflare accepts up to 25MiB inbound. The part that explains a failure is
   * the headers and the iCalendar block, both near the top, so a prefix is
   * worth far more than a null -- and `LONGTEXT` would happily store the whole
   * thing, which is how a diagnostic becomes a disk problem.
   */
  private truncateBody(raw: string | null): string | null {
    if (!raw) return null;
    if (Buffer.byteLength(raw, 'utf8') <= MAX_STORED_BODY_BYTES) return raw;
    return `${raw.slice(0, MAX_STORED_BODY_BYTES)}\n\n[truncated by the inbound log]`;
  }
}

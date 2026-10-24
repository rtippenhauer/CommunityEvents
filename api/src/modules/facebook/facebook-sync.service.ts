import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { FacebookAccountsService } from './facebook-accounts.service';
import { FacebookHeadcountService, sourcesToPlusOnes } from './facebook-headcount.service';
import { mergePlusOnes, toSource, withoutWebsiteGuests } from './plus-ones.util';
import type { FacebookSyncDto, FacebookSyncEventDto } from './dto/facebook-sync.dto';
import { EventStatus, RsvpSource, RsvpStatus, UserStatus } from '../../database/enums';
import { toDateString } from '../../common/utils/prisma-date.util';

/**
 * The Facebook Going-list sync (v2-29). v1's Phase 39 rules, re-implemented.
 *
 * ## The three passes are the contract, not an implementation detail
 *
 * Rule 1: **apply every list first, then reconcile each dinner, then count.**
 * A dinner can have several Facebook events, and whether somebody is Going
 * depends on *all* of its lists together (rule 3). Reconciling a dinner while
 * its second list is still unapplied would remove people who are on it, email
 * them that they were removed, and then add them back on the next pass -- so
 * the order is what keeps the sync from flapping.
 *
 * It is also why every Facebook event in one call gets back the same, final
 * `totalGoing` for its dinner: Muse writes that number into the Facebook event
 * description, and two descriptions for one dinner disagreeing would be worse
 * than either being slightly stale.
 *
 * ## What the sync may and may not do
 *
 * It may create and remove RSVPs **it made itself** (`source: facebook_sync`),
 * and it may rewrite `facebookGuestNames`/`facebookGuestCount` on any RSVP.
 * It may never touch `additionalGuests` or `guestNames`, which are the
 * member's own entry, and it may never remove an RSVP a member or an admin
 * made (rule 8). A sync that could delete what a person typed on the website
 * is one nobody can trust with a mirror.
 */
export interface SyncEventResult {
  facebookEventId: string;
  dinnerbearsEventId: number;
  group: string | null;
  status: 'ok' | 'skipped' | 'error';
  error?: string;
  accepted?: number;
  /** False when `going_count` disagreed with the guests sent (rule 12). */
  complete?: boolean;
  totalGoing?: number;
}

export interface SyncReport {
  extractedAt: string | null;
  events: SyncEventResult[];
  added: { eventId: number; userId: number; name: string; facebookGuests: (string | null)[] }[];
  guestsChanged: {
    eventId: number;
    userId: number;
    name: string;
    facebookGuests: (string | null)[];
    from: (string | null)[];
  }[];
  removed: { eventId: number; userId: number; name: string }[];
  unmatched: {
    facebookAccountId: number;
    name: string;
    profileUrl: string | null;
    suggestions: { id: number; fullName: string }[];
  }[];
  warnings: string[];
}

/** What one applied list recorded, carried from pass one into pass two. */
interface AppliedList {
  eventId: number;
  facebookEventId: string;
  /** False for a partial list: nobody is removed for this Facebook event. */
  complete: boolean;
  /** Facebook account ids seen on this list. */
  accountIds: Set<number>;
}

@Injectable()
export class FacebookSyncService {
  private readonly logger = new Logger(FacebookSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: FacebookAccountsService,
    private readonly headcount: FacebookHeadcountService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  async sync(dto: FacebookSyncDto, actorId: number): Promise<SyncReport> {
    const extractedAt = dto.extracted_at != null ? new Date(dto.extracted_at) : null;

    const report: SyncReport = {
      extractedAt: dto.extracted_at ?? null,
      events: [],
      added: [],
      guestsChanged: [],
      removed: [],
      unmatched: [],
      warnings: [],
    };

    // ---- Pass one: apply every list -------------------------------------
    const applied: AppliedList[] = [];

    for (const entry of dto.events) {
      // Rule 12: one failing Facebook event must not stop the batch. Each is
      // its own try, and its reason goes in that event's own result.
      try {
        const result = await this.applyOneList(entry, extractedAt, report);
        report.events.push(result.result);
        if (result.applied !== null) applied.push(result.applied);
      } catch (error) {
        this.logger.error(
          `Facebook event ${entry.facebook_event_id} failed: ${String(error)}`,
        );
        report.events.push({
          facebookEventId: entry.facebook_event_id,
          dinnerbearsEventId: entry.dinnerbears_event_id,
          group: entry.facebook_group ?? null,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // ---- Pass two: reconcile each affected dinner ------------------------
    const affectedEventIds = [...new Set(applied.map((list) => list.eventId))];

    for (const eventId of affectedEventIds) {
      await this.reconcileEvent(
        eventId,
        applied.filter((list) => list.eventId === eventId),
        actorId,
        report,
      );
    }

    // ---- Pass three: count ----------------------------------------------
    for (const eventId of affectedEventIds) {
      const counted = await this.headcount.forEvent(eventId);

      for (const result of report.events) {
        if (result.dinnerbearsEventId === eventId && result.status === 'ok') {
          result.totalGoing = counted.totalGoing;
        }
      }

      for (const name of counted.excludedByBan) {
        report.warnings.push(
          `${name} is Going on Facebook but is banned or deleted here — not added and not counted`,
        );
      }
    }

    report.unmatched = await this.unmatchedSeen(applied);

    await this.audit.log({
      userId: actorId,
      action: 'facebook.sync',
      metadata: {
        facebookEvents: dto.events.length,
        added: report.added.length,
        removed: report.removed.length,
        guestsChanged: report.guestsChanged.length,
        warnings: report.warnings.length,
      },
    });

    return report;
  }

  /**
   * Applies one Facebook event's Going list: links it to its dinner, records
   * every person seen, and writes each one's +1s for this list.
   */
  private async applyOneList(
    entry: FacebookSyncEventDto,
    extractedAt: Date | null,
    report: SyncReport,
  ): Promise<{ result: SyncEventResult; applied: AppliedList | null }> {
    const base = {
      facebookEventId: entry.facebook_event_id,
      dinnerbearsEventId: entry.dinnerbears_event_id,
      group: entry.facebook_group ?? null,
    };

    const event = await this.prisma.events.findFirst({
      where: { id: entry.dinnerbears_event_id },
      select: { id: true, status: true, eventDate: true },
    });

    if (event === null) {
      return { result: { ...base, status: 'error', error: 'No such event' }, applied: null };
    }
    if (event.status !== EventStatus.PUBLISHED) {
      // A draft is not a dinner anybody can be Going to yet, and a cancelled
      // one must not acquire attendees.
      return {
        result: { ...base, status: 'error', error: `Event is ${event.status}, not published` },
        applied: null,
      };
    }
    if (isPast(event.eventDate)) {
      return { result: { ...base, status: 'error', error: 'Event is in the past' }, applied: null };
    }

    // Rule 2: link on first sight; one Facebook event mirrors one dinner.
    const existingLink = await this.prisma.event_facebook_links.findFirst({
      where: { facebookEventId: entry.facebook_event_id },
      select: { id: true, eventId: true, lastExtractedAt: true },
    });

    let linkId: number;

    if (existingLink === null) {
      const created = await this.prisma.event_facebook_links.create({
        data: {
          eventId: event.id,
          facebookEventId: entry.facebook_event_id,
          facebookGroup: entry.facebook_group ?? null,
        },
        select: { id: true },
      });
      linkId = created.id;
      await this.audit.log({
        action: 'facebook.event_link',
        entityType: 'event',
        entityId: event.id,
        metadata: { facebookEventId: entry.facebook_event_id, group: entry.facebook_group ?? null },
      });
    } else if (existingLink.eventId !== event.id) {
      return {
        result: {
          ...base,
          status: 'error',
          error: `already linked to event ${existingLink.eventId}`,
        },
        applied: null,
      };
    } else {
      // Rule 12's replay guard, keyed on when the list was READ.
      if (
        extractedAt !== null &&
        existingLink.lastExtractedAt !== null &&
        extractedAt.getTime() < existingLink.lastExtractedAt.getTime()
      ) {
        return { result: { ...base, status: 'skipped' }, applied: null };
      }
      linkId = existingLink.id;
      if (entry.facebook_group !== undefined) {
        await this.prisma.event_facebook_links.updateMany({
          where: { id: linkId },
          data: { facebookGroup: entry.facebook_group },
        });
      }
    }

    // Rule 12: a going_count that disagrees with the guests sent means a
    // partial read. The list is still applied -- the people on it are really
    // Going -- but nobody is removed because of it.
    const complete =
      entry.going_count === undefined || entry.going_count === entry.guests.length;

    if (!complete) {
      report.warnings.push(
        `Facebook event ${entry.facebook_event_id}: going_count didn't match the guests sent — nobody was removed from it`,
      );
    }

    const accountIds = new Set<number>();

    for (const guest of entry.guests) {
      const account = await this.accounts.recordSeen({
        facebookUserId: guest.facebook_user_id,
        profileUrl: guest.profile_url,
        displayName: guest.name,
      });
      accountIds.add(account.id);

      const source = toSource(guest.plus_one_names, guest.plus_ones);
      await this.writeSource(event.id, account.id, entry.facebook_event_id, source);
    }

    // Drop this list's contribution for anybody no longer on it. Only when the
    // list is complete -- see above.
    if (complete) {
      await this.clearSourceForMissing(event.id, entry.facebook_event_id, accountIds);
    }

    await this.prisma.event_facebook_links.updateMany({
      where: { id: linkId },
      data: {
        lastSyncedAt: new Date(),
        lastExtractedAt: extractedAt ?? new Date(),
        lastGoingCount: entry.going_count ?? entry.guests.length,
      },
    });

    return {
      result: { ...base, status: 'ok', accepted: entry.guests.length, complete },
      applied: { eventId: event.id, facebookEventId: entry.facebook_event_id, complete, accountIds },
    };
  }

  /** Records one person's +1s for one of a dinner's Facebook events. */
  private async writeSource(
    eventId: number,
    facebookAccountId: number,
    facebookEventId: string,
    source: { names: string[]; total: number },
  ): Promise<void> {
    const existing = await this.prisma.facebook_event_attendees.findFirst({
      where: { eventId, facebookAccountId },
      select: { id: true, sources: true },
    });

    const sources = asSourceMap(existing?.sources);
    sources[facebookEventId] = { names: source.names, total: source.total };

    if (existing === null) {
      await this.prisma.facebook_event_attendees.create({
        data: { eventId, facebookAccountId, sources },
      });
      return;
    }

    await this.prisma.facebook_event_attendees.updateMany({
      where: { id: existing.id },
      data: { sources, updatedAt: new Date() },
    });
  }

  /**
   * Removes one Facebook event's entry from everybody who was on it before and
   * is not on it now.
   *
   * The row itself survives with an empty `sources` until reconciliation, which
   * then deletes it -- rule 3 means "on no list of this dinner", and that can
   * only be known once every list in the batch has been applied.
   */
  private async clearSourceForMissing(
    eventId: number,
    facebookEventId: string,
    stillPresent: ReadonlySet<number>,
  ): Promise<void> {
    const rows = await this.prisma.facebook_event_attendees.findMany({
      where: { eventId },
      select: { id: true, facebookAccountId: true, sources: true },
    });

    for (const row of rows) {
      if (stillPresent.has(row.facebookAccountId)) continue;

      const sources = asSourceMap(row.sources);
      if (!(facebookEventId in sources)) continue;

      delete sources[facebookEventId];
      await this.prisma.facebook_event_attendees.updateMany({
        where: { id: row.id },
        data: { sources, updatedAt: new Date() },
      });
    }
  }

  /**
   * Reconciles one dinner against all of its lists together (rule 1, step 2).
   *
   * This is where RSVPs are created, their Facebook +1s rewritten, and
   * sync-made RSVPs removed.
   */
  private async reconcileEvent(
    eventId: number,
    lists: readonly AppliedList[],
    actorId: number,
    report: SyncReport,
  ): Promise<void> {
    const event = await this.prisma.events.findFirst({
      where: { id: eventId },
      select: { id: true, eventDate: true, eventTime: true, locationName: true, locationAddress: true, status: true },
    });
    if (event === null) return;

    // Anybody on no list at all: the row has nothing left to say.
    const attendees = await this.prisma.facebook_event_attendees.findMany({
      where: { eventId },
      select: {
        id: true,
        facebookAccountId: true,
        sources: true,
        account: {
          select: {
            userId: true,
            displayName: true,
            user: { select: { fullName: true, status: true, deletedAt: true, email: true } },
          },
        },
      },
    });

    for (const attendee of attendees) {
      if (Object.keys(asSourceMap(attendee.sources)).length === 0) {
        await this.prisma.facebook_event_attendees.deleteMany({ where: { id: attendee.id } });
      }
    }

    // Group what is left by member, since rule 9 merges across a person's
    // accounts as well as across lists.
    const byMember = new Map<number, typeof attendees>();
    for (const attendee of attendees) {
      const userId = attendee.account.userId;
      if (userId === null) continue;
      if (Object.keys(asSourceMap(attendee.sources)).length === 0) continue;
      byMember.set(userId, [...(byMember.get(userId) ?? []), attendee]);
    }

    for (const [userId, rows] of byMember) {
      await this.applyMemberRsvp(
        eventId,
        userId,
        rows[0].account.user,
        rows.flatMap((row) => sourcesToPlusOnes(row.sources)),
        actorId,
        report,
      );
    }

    // Removal (rule 8). Only RSVPs the sync made, and only for members on no
    // list of this dinner -- and only if every list was complete, since a
    // partial read is not evidence that anybody left.
    if (lists.some((list) => !list.complete)) return;

    await this.removeDepartedMembers(eventId, byMember, actorId, report);
  }

  /**
   * Brings one member's RSVP into line with what the Facebook lists say.
   *
   * Extracted so the sync and the **link carry-over** (rule 14) apply exactly
   * the same rules. They are the same question asked at two moments -- "given
   * what Facebook says about this person, what should their RSVP be" -- and the
   * ways they could drift are the expensive ones: a +1 counted twice, or a
   * member's own guest list quietly overwritten.
   */
  private async applyMemberRsvp(
    eventId: number,
    userId: number,
    member: { fullName: string; status: string; deletedAt: Date | null } | null,
    plusOneSources: ReturnType<typeof sourcesToPlusOnes>,
    actorId: number,
    report: SyncReport,
  ): Promise<void> {
    {
      // Rule 13: banned or deleted members keep their link, are reported, and
      // are never added or counted. The warning is raised by the headcount
      // pass, which sees every such row rather than only the ones synced now.
      if (member == null || isBannedOrDeleted(member)) return;

      const rsvp = await this.prisma.event_rsvps.findFirst({
        where: { eventId, userId },
        select: {
          id: true,
          status: true,
          source: true,
          guestNames: true,
          facebookGuestNames: true,
          facebookGuestCount: true,
        },
      });

      const merged = mergePlusOnes(plusOneSources);
      // Rule 10: a Facebook +1 is skipped when a named website guest already
      // covers it. Only ever applied to the Facebook side; the website guests
      // are never altered.
      const net = withoutWebsiteGuests(merged, asNameList(rsvp?.guestNames));

      if (rsvp === null) {
        // Rule 7: a linked member not Going on the site is marked Going, with
        // the cutoff and membership gates skipped -- they have already said yes
        // in public, so refusing them here would leave the mirror disagreeing
        // with Facebook with nothing a member could do about it.
        await this.prisma.event_rsvps.create({
          data: {
            eventId,
            userId,
            status: RsvpStatus.GOING,
            source: RsvpSource.FACEBOOK_SYNC,
            additionalGuests: 0,
            facebookGuestNames: net.names,
            facebookGuestCount: net.total,
          },
        });

        report.added.push({
          eventId,
          userId,
          name: member.fullName,
          facebookGuests: padUnnamed(net),
        });

        await this.audit.log({
          userId: actorId,
          action: 'rsvp.facebook_sync',
          entityType: 'event',
          entityId: eventId,
          metadata: { targetUserId: userId, change: 'added' },
        });

        // The usual confirmation, noting that the sync added them.
        void this.events.sendSyncedRsvpConfirmation(eventId, userId);
        return;
      }

      // An existing RSVP: only the Facebook +1s may change, never the member's
      // own guests, and never the status of an RSVP they made themselves.
      const before = asNameList(rsvp.facebookGuestNames);
      const changed =
        rsvp.facebookGuestCount !== net.total || !sameNames(before, net.names);

      if (changed) {
        await this.prisma.event_rsvps.updateMany({
          where: { id: rsvp.id },
          data: { facebookGuestNames: net.names, facebookGuestCount: net.total },
        });

        report.guestsChanged.push({
          eventId,
          userId,
          name: member.fullName,
          facebookGuests: padUnnamed(net),
          from: before,
        });

        await this.audit.log({
          userId: actorId,
          action: 'rsvp.facebook_sync',
          entityType: 'event',
          entityId: eventId,
          metadata: { targetUserId: userId, change: 'guests' },
        });
      }

      // A member Going on Facebook whose site RSVP says otherwise is left
      // alone: their own answer wins. Only the +1s above are mirrored.
    }
  }

  /**
   * Deletes the sync's own RSVPs for members who are on none of this dinner's
   * lists, and strips the Facebook +1s from website RSVPs in the same position.
   */
  private async removeDepartedMembers(
    eventId: number,
    stillGoing: ReadonlyMap<number, unknown>,
    actorId: number,
    report: SyncReport,
  ): Promise<void> {
    const candidates = await this.prisma.event_rsvps.findMany({
      where: {
        eventId,
        OR: [{ source: RsvpSource.FACEBOOK_SYNC }, { facebookGuestCount: { gt: 0 } }],
      },
      select: {
        id: true,
        userId: true,
        source: true,
        facebookGuestCount: true,
        user: { select: { fullName: true } },
      },
    });

    for (const rsvp of candidates) {
      if (stillGoing.has(rsvp.userId)) continue;

      if (rsvp.source === RsvpSource.FACEBOOK_SYNC) {
        await this.prisma.event_rsvps.deleteMany({ where: { id: rsvp.id } });
        report.removed.push({
          eventId,
          userId: rsvp.userId,
          name: rsvp.user?.fullName ?? '',
        });
        await this.audit.log({
          userId: actorId,
          action: 'rsvp.facebook_sync',
          entityType: 'event',
          entityId: eventId,
          metadata: { targetUserId: rsvp.userId, change: 'removed' },
        });
        continue;
      }

      // A website RSVP stays and only loses its Facebook +1s (rule 8).
      if (rsvp.facebookGuestCount > 0) {
        await this.prisma.event_rsvps.updateMany({
          where: { id: rsvp.id },
          data: { facebookGuestNames: [], facebookGuestCount: 0 },
        });
        report.guestsChanged.push({
          eventId,
          userId: rsvp.userId,
          name: rsvp.user?.fullName ?? '',
          facebookGuests: [],
          from: [],
        });
      }
    }
  }


  /**
   * Rule 14: linking carries over, immediately (Rob, 2026-10-23).
   *
   * The moment an admin ties a Facebook person to a member, everything that
   * person's Facebook presence already implied becomes true of the member --
   * without waiting for the next sync, which may be a day away and is driven
   * from outside.
   *
   * Two halves, and they are different operations:
   *
   *  - **Upcoming dinners** they are Going to on Facebook become Going RSVPs,
   *    through the same `applyMemberRsvp` the sync uses. Same rules, including
   *    the +1 merge across every account this member has and the refusal to
   *    touch their own website guests.
   *  - **Past dinners** where the Facebook-only person was marked *Attended*
   *    become attended RSVPs **through the normal attendance path**, so points,
   *    the coordinator award, event achievements and Secret Dinner all land
   *    exactly as they would have if they had been a member on the night. That
   *    is the whole point of doing this rather than only fixing the future:
   *    the attendance already happened, and it should count.
   *
   * The merge reads every account the member has, not just the one being
   * linked: somebody with two Facebook profiles on two groups' lists is one
   * person at one table, and counting the account in isolation would be the
   * double-count rule 9 exists to prevent.
   */
  async carryOverLinkedAccount(
    accountId: number,
    userId: number,
    actorId: number,
  ): Promise<{ upcoming: number; attended: number }> {
    const member = await this.prisma.users.findFirst({
      where: { id: userId },
      select: { fullName: true, status: true, deletedAt: true },
    });
    if (member === null || isBannedOrDeleted(member)) return { upcoming: 0, attended: 0 };

    // Every event this account appears on. `attended` is the Facebook-only
    // row's mark, which is what the past half turns into a real RSVP.
    const rows = await this.prisma.facebook_event_attendees.findMany({
      where: { facebookAccountId: accountId },
      select: { eventId: true, attended: true },
    });
    if (rows.length === 0) return { upcoming: 0, attended: 0 };

    // Discarded afterwards: this runs outside a sync, so there is no report to
    // return. It exists because `applyMemberRsvp` writes into one.
    const report: SyncReport = {
      extractedAt: null,
      events: [],
      added: [],
      guestsChanged: [],
      removed: [],
      unmatched: [],
      warnings: [],
    };

    let upcoming = 0;
    let attended = 0;

    for (const row of rows) {
      const event = await this.prisma.events.findFirst({
        where: { id: row.eventId },
        select: { id: true, status: true, eventDate: true },
      });
      // A cancelled or draft dinner acquires nobody, in either direction.
      if (event === null || event.status !== EventStatus.PUBLISHED) continue;

      // Every one of this member's accounts, so the +1 merge sees them all.
      const allRows = await this.prisma.facebook_event_attendees.findMany({
        where: { eventId: event.id, account: { userId } },
        select: { sources: true },
      });
      const sources = allRows.flatMap((candidate) => sourcesToPlusOnes(candidate.sources));

      if (!isPast(event.eventDate)) {
        await this.applyMemberRsvp(event.id, userId, member, sources, actorId, report);
        upcoming += 1;
        continue;
      }

      // Past, and only where somebody actually marked them present. A NULL
      // `attended` is "not marked", not "did not come", so it earns nothing.
      if (row.attended !== true) continue;

      const existing = await this.prisma.event_rsvps.findFirst({
        where: { eventId: event.id, userId },
        select: { id: true, status: true, attended: true },
      });

      if (existing === null) {
        await this.prisma.event_rsvps.create({
          data: {
            eventId: event.id,
            userId,
            status: RsvpStatus.GOING,
            source: RsvpSource.FACEBOOK_SYNC,
            additionalGuests: 0,
          },
        });
      } else if (existing.attended === true) {
        // Already credited. Awarding again would double their points.
        continue;
      }

      // The normal path, so points and achievements are awarded exactly as a
      // moderator marking the register would have done.
      await this.events.markAttendance(event.id, [{ userId, attended: true }]);
      attended += 1;

      await this.audit.log({
        userId: actorId,
        action: 'rsvp.facebook_sync',
        entityType: 'event',
        entityId: event.id,
        metadata: { targetUserId: userId, change: 'attended_on_link', facebookAccountId: accountId },
      });
    }

    this.logger.log(
      `Linked Facebook account ${accountId} to member ${userId}: ` +
        `${upcoming} upcoming RSVP(s), ${attended} past attendance(s) credited.`,
    );

    return { upcoming, attended };
  }

  /**
   * The people this run saw who are not linked to a member and not marked
   * "not a member" -- the admin's review queue, with name suggestions.
   */
  private async unmatchedSeen(applied: readonly AppliedList[]): Promise<SyncReport['unmatched']> {
    const seen = new Set<number>();
    for (const list of applied) for (const id of list.accountIds) seen.add(id);
    if (seen.size === 0) return [];

    const all = await this.accounts.list('unmatched');

    return all
      .filter((account) => seen.has(account.id))
      .map((account) => ({
        facebookAccountId: account.id,
        name: account.displayName,
        profileUrl: account.profileUrl,
        suggestions: account.suggestions,
      }));
  }
}

/** `sources` is a JSON column; read it back defensively. */
function asSourceMap(value: unknown): Record<string, { names: string[]; total: number }> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};

  const out: Record<string, { names: string[]; total: number }> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as { names?: unknown; total?: unknown };
    out[key] = {
      names: Array.isArray(record.names) ? record.names.filter((n): n is string => typeof n === 'string') : [],
      total: typeof record.total === 'number' ? record.total : 0,
    };
  }
  return out;
}

function asNameList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((n): n is string => typeof n === 'string') : [];
}

/**
 * The report's `facebookGuests` shape: named +1s, then `null` for each unnamed
 * one. The contract shows `["Carol Smith", null]`, so an unnamed +1 is visible
 * in the report rather than only implied by a count the report does not carry.
 */
function padUnnamed(merged: { names: string[]; total: number }): (string | null)[] {
  const unnamed = Math.max(0, merged.total - merged.names.length);
  return [...merged.names, ...Array.from({ length: unnamed }, () => null)];
}

/** Both sides come from `mergePlusOnes`, which sorts, so order is comparable. */
function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

function isBannedOrDeleted(user: {
  status?: string;
  deletedAt?: Date | null;
}): boolean {
  if (user.deletedAt != null) return true;
  return user.status === UserStatus.SUSPENDED || user.status === UserStatus.DELETED;
}

/** Eastern-day comparison, matching how every other date in this codebase works. */
function isPast(eventDate: Date): boolean {
  const today = toDateString(new Date());
  return toDateString(eventDate) < today;
}

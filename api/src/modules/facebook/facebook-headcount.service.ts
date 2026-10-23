import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { RsvpStatus, UserStatus } from '../../database/enums';
import { mergePlusOnes, toSource, type PlusOneSource } from './plus-ones.util';

/**
 * The merged headcount (v2-29, rule 11).
 *
 * One place, because three callers need the same number and would otherwise
 * each grow their own idea of it: the sync's `totalGoing` response (which Muse
 * writes into a Facebook event description), `GET /events/:id/attendees`, and
 * the event list's `goingCount`. v2 has already shipped the same number
 * computed twice -- `v2-43` found the anonymous credit count counting rows
 * where the name count counted people, so one community read "2 community
 * members" and another read one name.
 *
 *   totalGoing = for each Going RSVP: 1 + website guests + Facebook +1s
 *              + public guest signups
 *              + Facebook-only attendees and their +1s
 *
 * `goingCount` on the event list is the same minus public guest signups, which
 * is the one difference the Muse contract calls out explicitly.
 *
 * ## A banned or deleted member is counted nowhere (rule 13)
 *
 * They keep their Facebook link, and they are reported in the sync's
 * `warnings`, but they are not added and not counted -- and specifically they
 * do **not** fall through into the Facebook-only bucket, which would be the
 * easy mistake: their account *is* linked, so "unlinked means Facebook-only"
 * silently re-counts the person the ban was meant to remove.
 */
export interface Headcount {
  /** Rule 11 in full. What Muse writes into the Facebook description. */
  totalGoing: number;
  /** Rule 11 without public guest signups -- the event list's `goingCount`. */
  goingCount: number;
  /** Facebook people not linked to any member, with their merged +1s. */
  facebookOnly: {
    facebookAccountId: number;
    name: string;
    plusOnes: number;
    plusOneNames: string[];
    attended: boolean | null;
  }[];
  /** Names of linked members excluded by rule 13, for the sync's warnings. */
  excludedByBan: string[];
}

/** `sources` as stored on `facebook_event_attendees`: Facebook event id -> +1s. */
type StoredSources = Record<string, { names?: string[]; total?: number }>;

/**
 * Reads the stored `sources` JSON back into merge inputs.
 *
 * Defensive about shape because this is a JSON column: a row written by an
 * older build, or hand-edited during an incident, must not throw inside a
 * headcount that a restaurant booking depends on. An unreadable entry
 * contributes nothing rather than failing the whole count.
 */
export function sourcesToPlusOnes(sources: unknown): PlusOneSource[] {
  if (sources === null || typeof sources !== 'object' || Array.isArray(sources)) return [];

  return Object.values(sources as StoredSources)
    .filter((entry): entry is { names?: string[]; total?: number } =>
      entry !== null && typeof entry === 'object' && !Array.isArray(entry),
    )
    .map((entry) => toSource(Array.isArray(entry.names) ? entry.names : [], entry.total ?? 0));
}

@Injectable()
export class FacebookHeadcountService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The headcount for one dinner.
   *
   * Three queries rather than one join, deliberately: the +1 merge is done in
   * TypeScript (rule 9 is a max over multisets, which SQL expresses badly), so
   * the rows have to come back anyway. All three are tenant-scoped by the
   * extension.
   */
  async forEvent(eventId: number): Promise<Headcount> {
    const [rsvps, publicGuests, attendees] = await Promise.all([
      this.prisma.event_rsvps.findMany({
        where: { eventId, status: RsvpStatus.GOING },
        select: {
          userId: true,
          additionalGuests: true,
          facebookGuestCount: true,
          user: { select: { fullName: true, status: true } },
        },
      }),
      this.prisma.event_guest_links.count({
        where: { eventId, source: 'public', cancelledAt: null },
      }),
      this.prisma.facebook_event_attendees.findMany({
        where: { eventId },
        select: {
          facebookAccountId: true,
          sources: true,
          attended: true,
          account: {
            select: {
              displayName: true,
              userId: true,
              user: { select: { fullName: true, status: true, deletedAt: true } },
            },
          },
        },
      }),
    ]);

    const excludedByBan: string[] = [];
    let members = 0;

    for (const rsvp of rsvps) {
      // A Going RSVP belonging to a suspended or soft-deleted member is not a
      // seat at the table. The sync refuses to create these, but one can exist
      // from before a ban.
      if (isBannedOrDeleted(rsvp.user)) {
        if (rsvp.user?.fullName) excludedByBan.push(rsvp.user.fullName);
        continue;
      }
      members += 1 + rsvp.additionalGuests + rsvp.facebookGuestCount;
    }

    const facebookOnly: Headcount['facebookOnly'] = [];
    let facebookOnlySeats = 0;

    for (const attendee of attendees) {
      const account = attendee.account;

      // Linked to a member: already counted (or deliberately not) through the
      // RSVP above. Counting them here as well is the double-count rule 9
      // exists to prevent, one level up.
      if (account.userId !== null) {
        if (isBannedOrDeleted(account.user) && account.user?.fullName) {
          excludedByBan.push(account.user.fullName);
        }
        continue;
      }

      const merged = mergePlusOnes(sourcesToPlusOnes(attendee.sources));
      facebookOnly.push({
        facebookAccountId: attendee.facebookAccountId,
        name: account.displayName,
        plusOnes: merged.total,
        plusOneNames: merged.names,
        attended: attendee.attended,
      });
      facebookOnlySeats += 1 + merged.total;
    }

    const goingCount = members + facebookOnlySeats;

    return {
      goingCount,
      totalGoing: goingCount + publicGuests,
      facebookOnly,
      // De-duplicated: a banned member can hold both an RSVP and a linked
      // Facebook account, and the warning is about the person, not the rows.
      excludedByBan: [...new Set(excludedByBan)],
    };
  }

  /**
   * `goingCount` for many events at once, for the event list.
   *
   * Separate from `forEvent` because the list renders dozens of events and
   * cannot afford three queries each. Returns only the number, since the list
   * shows no Facebook detail.
   */
  async goingCountsFor(eventIds: readonly number[]): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    if (eventIds.length === 0) return counts;

    const [rsvps, attendees] = await Promise.all([
      this.prisma.event_rsvps.findMany({
        where: { eventId: { in: [...eventIds] }, status: RsvpStatus.GOING },
        select: {
          eventId: true,
          additionalGuests: true,
          facebookGuestCount: true,
          user: { select: { status: true, deletedAt: true } },
        },
      }),
      this.prisma.facebook_event_attendees.findMany({
        where: { eventId: { in: [...eventIds] } },
        select: {
          eventId: true,
          sources: true,
          account: { select: { userId: true } },
        },
      }),
    ]);

    for (const rsvp of rsvps) {
      if (isBannedOrDeleted(rsvp.user)) continue;
      const seats = 1 + rsvp.additionalGuests + rsvp.facebookGuestCount;
      counts.set(rsvp.eventId, (counts.get(rsvp.eventId) ?? 0) + seats);
    }

    for (const attendee of attendees) {
      if (attendee.account.userId !== null) continue;
      const merged = mergePlusOnes(sourcesToPlusOnes(attendee.sources));
      const seats = 1 + merged.total;
      counts.set(attendee.eventId, (counts.get(attendee.eventId) ?? 0) + seats);
    }

    return counts;
  }
}

/** Rule 13's test. `deletedAt` is the soft-delete stage, before hard delete. */
function isBannedOrDeleted(
  user: { status?: string; deletedAt?: Date | null } | null | undefined,
): boolean {
  if (user === null || user === undefined) return false;
  if (user.deletedAt != null) return true;
  return user.status === UserStatus.SUSPENDED || user.status === UserStatus.DELETED;
}

import type { locations as Location } from '@prisma/client';
import type { PrismaService } from '../../database/prisma/prisma.service';
import { EventStatus } from '../../database/enums';
import { toDateColumn } from './prisma-date.util';

/**
 * The Eastern calendar date, 'YYYY-MM-DD' -- the same notion of "today" the
 * upcoming/past split in `EventsService.findAll` uses.
 */
export function easternToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
}

/** The location columns an event keeps its own copy of. */
export type EventLocationDetails = Pick<Location, 'id' | 'name' | 'address' | 'lat' | 'lng'>;

/**
 * Events keep their own copy of their location's name, address and
 * coordinates, so a past dinner still shows where it actually was after the
 * place is renamed or moves. Upcoming (and today's) events should follow the
 * location, though -- otherwise correcting a location leaves the old text on
 * every dinner already scheduled there, and the only workaround (switching the
 * event away and back) emails every RSVP a "details changed" notice.
 * Cancelled and past events are left alone. Sends nothing.
 *
 * Both the manual edit and enrichment write through this one helper (v1 PR
 * #41); a rename that took any other path would leave the copy stale. Scoped by
 * the tenant extension like any other `events` write -- a location id already
 * belongs to exactly one community, so the predicate only narrows further.
 */
export async function refreshUpcomingEventLocations(
  prisma: Pick<PrismaService, 'events'>,
  location: EventLocationDetails,
): Promise<number> {
  const result = await prisma.events.updateMany({
    where: {
      locationId: location.id,
      eventDate: { gte: toDateColumn(easternToday()) },
      status: { not: EventStatus.CANCELLED },
    },
    data: {
      locationName: location.name,
      locationAddress: location.address,
      locationLat: location.lat,
      locationLng: location.lng,
    },
  });
  return result.count;
}

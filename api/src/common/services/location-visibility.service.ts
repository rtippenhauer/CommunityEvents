import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventRsvpEntity, RsvpStatus } from '../../database/entities/event-rsvp.entity';
import { UserEntity, UserRole } from '../../database/entities/user.entity';

export interface PrivateLocationLike {
  id: number;
  isPrivate: boolean;
}

// Shared by LocationsService (the browsable /locations pages) and
// EventsService (event snapshot fields) so a private location's address is
// gated identically everywhere it could otherwise leak: hidden from anyone
// who isn't admin/mod and hasn't RSVP'd "Going" — including unauthenticated
// or not-yet-RSVP'd viewers, who simply never satisfy either condition.
@Injectable()
export class LocationVisibilityService {
  constructor(
    @InjectRepository(EventRsvpEntity)
    private readonly rsvpRepo: Repository<EventRsvpEntity>,
  ) {}

  isAdminOrMod(user: UserEntity | null | undefined): boolean {
    return user?.role === UserRole.ADMIN || user?.role === UserRole.MODERATOR;
  }

  // Pure decision, no DB access — for callers that already know (or have
  // batch-computed, e.g. EventsService.findAll's myRsvpMap) whether the
  // viewer has a Going RSVP, so we don't fire one query per row.
  canViewAddressSync(
    location: PrivateLocationLike,
    isPrivileged: boolean,
    hasGoingRsvp: boolean,
  ): boolean {
    if (!location.isPrivate) return true;
    if (isPrivileged) return true;
    return hasGoingRsvp;
  }

  // eventId: check RSVP status for that specific event (event-detail, guest-rsvp,
  // invite preview, calendar export). Omit it to check "has this user RSVP'd
  // Going to ANY event at this location" (the standalone Locations pages).
  async canViewAddress(
    location: PrivateLocationLike,
    user: UserEntity | null | undefined,
    eventId?: number,
  ): Promise<boolean> {
    if (!location.isPrivate) return true;
    if (this.isAdminOrMod(user)) return true;
    if (!user) return false;

    const qb = this.rsvpRepo
      .createQueryBuilder('rsvp')
      .innerJoin('rsvp.event', 'e')
      .where('rsvp.userId = :userId', { userId: user.id })
      .andWhere('rsvp.status = :status', { status: RsvpStatus.GOING });

    if (eventId) {
      qb.andWhere('e.id = :eventId', { eventId });
    } else {
      qb.andWhere('e.locationId = :locationId', { locationId: location.id });
    }

    const row = await qb.select('rsvp.id').limit(1).getRawOne<{ rsvp_id: number }>();
    return !!row;
  }

  // Returns a shallow copy with address/lat/lng nulled out when not visible —
  // never mutates the entity/object passed in.
  async redact<T extends { address: unknown; lat: unknown; lng: unknown }>(
    location: T & PrivateLocationLike,
    user: UserEntity | null | undefined,
    eventId?: number,
  ): Promise<T> {
    const visible = await this.canViewAddress(location, user, eventId);
    if (visible) return location;
    return { ...location, address: null, lat: null, lng: null };
  }

  // Same idea, for objects carrying an event's location *snapshot* fields
  // (locationAddress/locationLat/locationLng) rather than a LocationEntity
  // itself — e.g. EventEntity, or a plain response DTO built from one.
  async redactEventSnapshot<
    T extends { locationAddress: unknown; locationLat: unknown; locationLng: unknown },
  >(
    event: T,
    location: PrivateLocationLike | null | undefined,
    user: UserEntity | null | undefined,
    eventId?: number,
  ): Promise<T> {
    if (!location) return event;
    const visible = await this.canViewAddress(location, user, eventId);
    if (visible) return event;
    return { ...event, locationAddress: null, locationLat: null, locationLng: null };
  }

  // Sync variant of redactEventSnapshot for batch endpoints that already
  // know the viewer's RSVP status for this event (e.g. EventsService.findAll).
  redactEventSnapshotSync<
    T extends { locationAddress: unknown; locationLat: unknown; locationLng: unknown },
  >(
    event: T,
    location: PrivateLocationLike | null | undefined,
    isPrivileged: boolean,
    hasGoingRsvp: boolean,
  ): T {
    if (!location) return event;
    if (this.canViewAddressSync(location, isPrivileged, hasGoingRsvp)) return event;
    return { ...event, locationAddress: null, locationLat: null, locationLng: null };
  }
}

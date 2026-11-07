import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { IntegrationsService } from '../integrations/integrations.service';
import type { IssuedToken } from '../integrations/api-token.service';
import { FacebookHeadcountService } from '../facebook/facebook-headcount.service';
import { FacebookSyncService, type SyncReport } from '../facebook/facebook-sync.service';
import { LocationsService } from '../locations/locations.service';
import { LocationVisibilityService } from '../../common/services/location-visibility.service';
import { AppConfigService } from '../app-config/app-config.service';
import { InvitesService } from '../invites/invites.service';
import { AuditService } from '../audit/audit.service';
import { TenantResolutionService } from '../../common/tenant/tenant-resolution.service';
import { EXCLUDE_SERVICE_ACCOUNTS } from '../../common/utils/service-account.util';
import { EventStatus, InviteFlavor, UserRole, UserStatus } from '../../database/enums';
import { toDateString, toTimeString } from '../../common/utils/prisma-date.util';
import type { FacebookSyncDto } from '../facebook/dto/facebook-sync.dto';

/**
 * What the Muse routes do (v2-29). The contract is `docs/MUSE_API.md` and is
 * v1's, unchanged -- Muse is an outside app already speaking it, so the shapes
 * here are not ours to tidy.
 *
 * Everything is read-only except linking Facebook events, invite links and the
 * sync. There is no route that edits a dinner: events are created and edited on
 * the website, and CommunityEvents is the source of truth for which Facebook
 * event mirrors which dinner.
 */
export interface MuseIdentity {
  userId: number;
  name: string;
  tokenExpiresAt: string | null;
  /**
   * Not in v1's contract and additive on purpose.
   *
   * v1 is single-tenant, so "which site am I talking to" could not be asked.
   * Here it is the only thing that proves the token resolved the community the
   * caller expected -- and it is read back through a **scoped** query rather
   * than off the token, so if the AsyncLocalStorage context and the token ever
   * disagree this route reports it instead of agreeing with itself.
   */
  community: { id: number; slug: string; domain: string };
}

export interface MuseFacebookEvent {
  facebookEventId: string;
  group: string | null;
  url: string;
  lastSyncedAt: Date | null;
  lastGoingCount: number | null;
}

@Injectable()
export class MuseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly headcount: FacebookHeadcountService,
    private readonly facebookSync: FacebookSyncService,
    private readonly locations: LocationsService,
    private readonly locationVisibility: LocationVisibilityService,
    private readonly appConfig: AppConfigService,
    private readonly invites: InvitesService,
    private readonly audit: AuditService,
    private readonly tenants: TenantResolutionService,
  ) {}

  // ---- token -----------------------------------------------------------

  async identify(userId: number, tokenId: number): Promise<MuseIdentity> {
    const account = await this.prisma.users.findFirst({
      where: { id: userId },
      select: { id: true, fullName: true, tenantId: true },
    });

    if (account === null) {
      // Unreachable through the guard, which has verified the account. Worth
      // refusing rather than asserting: it would mean the tenant context and
      // the token disagree, which is the fault this route exposes.
      throw new NotFoundException('Integration account not found in this community.');
    }

    const [token, community] = await Promise.all([
      this.prisma.api_tokens.findFirst({
        where: { id: tokenId },
        select: { expiresAt: true },
      }),
      this.prisma.tenants.findFirst({
        where: { id: account.tenantId },
        select: { id: true, slug: true, domain: true },
      }),
    ]);

    if (community === null) throw new NotFoundException('Community not found.');

    return {
      userId: account.id,
      name: account.fullName,
      tokenExpiresAt: token?.expiresAt.toISOString() ?? null,
      community,
    };
  }

  rotateToken(userId: number): Promise<IssuedToken> {
    return this.integrations.rotateOwnToken(userId);
  }

  // ---- members, locations ----------------------------------------------

  /**
   * Active members, names and ids only.
   *
   * **No contact details, deliberately**, and the contract says so: Muse does
   * no matching (rule 5 puts that with an admin), so an email address here
   * would be a mailing list handed to an outside app for display purposes.
   * Service and integration accounts are excluded -- they are not people.
   */
  async members(): Promise<{ id: number; fullName: string; cityId: number | null; role: string }[]> {
    return this.prisma.users.findMany({
      where: {
        status: UserStatus.ACTIVE,
        deletedAt: null,
        ...EXCLUDE_SERVICE_ACCOUNTS,
        role: { notIn: [UserRole.AUTOMATION, UserRole.MUSE, UserRole.DISABLED] },
      },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      select: { id: true, fullName: true, cityId: true, role: true },
    });
  }

  /**
   * Locations, with private ones redacted.
   *
   * Goes through `findAllForUser(query, null)` rather than `findAll`, so Muse
   * is treated as "not an admin or moderator" and a residence comes back
   * without its address, coordinates or photos -- exactly what the contract
   * promises. Passing the integration's own user row instead would ask the
   * visibility helper a question about a non-person, and the answer that
   * matters here is "no privileges".
   */
  locationsFor(query: { cityId?: number; search?: string }) {
    return this.locations.findAllForUser(query, null);
  }

  // ---- events ----------------------------------------------------------

  /**
   * Upcoming events including drafts, each with its Facebook events.
   *
   * Drafts are included because Muse needs to know a dinner exists before it is
   * published -- it creates the Facebook event ahead of time. The sync itself
   * still refuses to attach attendees to a draft.
   */
  async events(query: { cityId?: number; fromDate?: string }) {
    const from = query.fromDate ?? toDateString(new Date());

    const events = await this.prisma.events.findMany({
      where: {
        eventDate: { gte: new Date(`${from}T00:00:00.000Z`) },
        ...(query.cityId !== undefined ? { cityId: query.cityId } : {}),
        status: { not: EventStatus.CANCELLED },
      },
      orderBy: [{ eventDate: 'asc' }, { eventTime: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        cityId: true,
        locationId: true,
        locationName: true,
        locationAddress: true,
        locationLat: true,
        locationLng: true,
        title: true,
        eventDate: true,
        eventTime: true,
        status: true,
        location: {
          select: {
            id: true,
            name: true,
            address: true,
            lat: true,
            lng: true,
            cityId: true,
            isPrivate: true,
            isResidence: true,
            // photos[0] is "the cover photo" Muse sets on the Facebook event.
            // Ordered by id so the same dinner does not change cover between
            // calls -- the ordering v1 spells out in both of its queries.
            photos: { orderBy: { id: 'asc' as const } },
          },
        },
      },
    });

    const ids = events.map((event) => event.id);
    const [links, counts, sharePrivate] = await Promise.all([
      this.linksFor(ids),
      this.headcount.goingCountsFor(ids),
      this.mayPublishPrivateVenues(),
    ]);

    return events.map((event) => ({
      ...this.redactPrivateVenue(event, sharePrivate),
      // Date strings, never ISO timestamps. The trap `v2-11` found: the write
      // endpoints returned ISO where the reads returned date strings, and
      // publishing an event redrew 6:30pm as 12:30.
      eventDate: toDateString(event.eventDate),
      eventTime: toTimeString(event.eventTime),
      goingCount: counts.get(event.id) ?? 0,
      facebookEvents: links.get(event.id) ?? [],
    }));
  }

  /** One event, with everything the sync and the Facebook description need. */
  async event(id: number) {
    const event = await this.prisma.events.findFirst({
      where: { id },
      include: {
        city: true,
        location: { include: { photos: { orderBy: { id: 'asc' } } } },
      },
    });
    if (event === null) throw new NotFoundException('No such event.');

    const [links, attendees, sharePrivate] = await Promise.all([
      this.linksFor([id]),
      this.attendees(id),
      this.mayPublishPrivateVenues(),
    ]);

    return {
      ...this.redactPrivateVenue(event, sharePrivate),
      eventDate: toDateString(event.eventDate),
      eventTime: toTimeString(event.eventTime),
      facebookEvents: links.get(id) ?? [],
      rsvps: attendees.members,
      publicRsvps: attendees.publicGuests,
      facebookAttendees: attendees.facebookOnly,
      goingCount: attendees.totalGoing,
    };
  }

  /**
   * Blank a private venue's address, coordinates and photos.
   *
   * `muse` is not an elevated role and the integration holds no RSVP, so this
   * always fires for a private venue -- which is what v1 does, since it reads
   * events through `findOne(id, UserRole.MUSE, …)` and lands on the same
   * branch. Worth stating rather than assuming: the photos go too, because a
   * picture of somebody's house reveals the address the other three fields
   * withhold, and Muse would publish it as a Facebook event cover.
   */
  /**
   * Whether this community lets Muse publish a private venue to Facebook.
   *
   * Off unless an admin opted in on Admin -> Automation Accounts. Read per
   * request rather than cached on the service: the answer belongs to the
   * community the token resolved, and this service is a singleton.
   */
  private async mayPublishPrivateVenues(): Promise<boolean> {
    return (await this.appConfig.getSiteSetting('muse_share_private_venues')) === 'true';
  }

  private redactPrivateVenue<T extends { location?: unknown }>(
    event: T,
    sharePrivate: boolean,
  ): T {
    if (sharePrivate) return event;
    const location = event.location as { isPrivate?: boolean } | null | undefined;
    if (!location || this.locationVisibility.canViewAddressSync(location as never, false, false)) {
      return event;
    }
    return {
      ...event,
      locationAddress: null,
      locationLat: null,
      locationLng: null,
      location: { ...location, address: null, lat: null, lng: null, photos: [] },
    };
  }

  /**
   * Everyone signed up, from every source, with the merged headcount.
   *
   * The three buckets are kept separate rather than flattened because they
   * answer different questions and are acted on differently: a member has an
   * account and notification preferences, a public guest came through a share
   * link, and a Facebook-only attendee is somebody nobody here has an account
   * for.
   */
  async attendees(eventId: number) {
    const event = await this.prisma.events.findFirst({
      where: { id: eventId },
      select: { id: true },
    });
    if (event === null) throw new NotFoundException('No such event.');

    const [rsvps, publicGuests, counted] = await Promise.all([
      this.prisma.event_rsvps.findMany({
        where: { eventId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          userId: true,
          status: true,
          additionalGuests: true,
          guestNames: true,
          facebookGuestNames: true,
          facebookGuestCount: true,
          source: true,
          attended: true,
          isWalkin: true,
          updatedAt: true,
          user: { select: { fullName: true } },
        },
      }),
      this.prisma.event_guest_links.findMany({
        where: { eventId, source: 'public', cancelledAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, recipientName: true, attended: true, createdAt: true },
      }),
      this.headcount.forEvent(eventId),
    ]);

    return {
      eventId,
      members: rsvps.map((rsvp) => ({
        userId: rsvp.userId,
        fullName: rsvp.user?.fullName ?? '',
        status: rsvp.status,
        additionalGuests: rsvp.additionalGuests,
        guestNames: asNames(rsvp.guestNames),
        // Named +1s then `null` for each unnamed one, matching the contract --
        // so an unnamed +1 is visible rather than only implied by a count.
        facebookGuests: withUnnamed(asNames(rsvp.facebookGuestNames), rsvp.facebookGuestCount),
        source: rsvp.source,
        attended: rsvp.attended,
        isWalkin: rsvp.isWalkin,
        updatedAt: rsvp.updatedAt,
      })),
      publicGuests: publicGuests.map((guest) => ({
        guestLinkId: guest.id,
        name: guest.recipientName,
        attended: guest.attended,
        createdAt: guest.createdAt,
      })),
      facebookOnly: counted.facebookOnly,
      totalGoing: counted.totalGoing,
    };
  }

  // ---- Facebook event links --------------------------------------------

  /**
   * Links a Facebook event to a dinner, or updates its group. Idempotent.
   *
   * 409 when that Facebook event already mirrors a different dinner (rule 2) --
   * one Facebook event cannot stand for two dinners, and silently re-pointing
   * it would move a whole Going list onto the wrong night.
   */
  async linkFacebookEvent(
    eventId: number,
    facebookEventId: string,
    group: string | null,
    actorId: number,
  ): Promise<MuseFacebookEvent> {
    if (!/^\d{1,32}$/.test(facebookEventId)) {
      throw new BadRequestException('facebook_event_id must be digits.');
    }

    const event = await this.prisma.events.findFirst({
      where: { id: eventId },
      select: { id: true },
    });
    if (event === null) throw new NotFoundException('No such event.');

    const existing = await this.prisma.event_facebook_links.findFirst({
      where: { facebookEventId },
      select: { id: true, eventId: true },
    });

    if (existing !== null && existing.eventId !== eventId) {
      throw new ConflictException(`already linked to event ${existing.eventId}`);
    }

    if (existing === null) {
      await this.prisma.event_facebook_links.create({
        data: { eventId, facebookEventId, facebookGroup: group },
      });
    } else if (group !== null) {
      await this.prisma.event_facebook_links.updateMany({
        where: { id: existing.id },
        data: { facebookGroup: group },
      });
    }

    await this.audit.log({
      userId: actorId,
      action: 'facebook.event_link',
      entityType: 'event',
      entityId: eventId,
      metadata: { facebookEventId, group },
    });

    const links = await this.linksFor([eventId]);
    const link = (links.get(eventId) ?? []).find(
      (candidate) => candidate.facebookEventId === facebookEventId,
    );
    if (link === undefined) throw new NotFoundException('Link not found after write.');
    return link;
  }

  /**
   * Unlinks a Facebook event and drops its Going list from the dinner.
   *
   * Anybody who was only on that list stops counting, which is rule 3 applied
   * to the removal of a whole list: their `sources` entry for this Facebook
   * event goes, and a row left with no sources at all is deleted.
   */
  async unlinkFacebookEvent(
    eventId: number,
    facebookEventId: string,
    actorId: number,
  ): Promise<{ success: true }> {
    const link = await this.prisma.event_facebook_links.findFirst({
      where: { facebookEventId, eventId },
      select: { id: true },
    });
    if (link === null) throw new NotFoundException('That Facebook event is not linked to this event.');

    const attendees = await this.prisma.facebook_event_attendees.findMany({
      where: { eventId },
      select: { id: true, sources: true },
    });

    for (const attendee of attendees) {
      const sources = asSourceMap(attendee.sources);
      if (!(facebookEventId in sources)) continue;

      delete sources[facebookEventId];

      if (Object.keys(sources).length === 0) {
        await this.prisma.facebook_event_attendees.deleteMany({ where: { id: attendee.id } });
        continue;
      }
      await this.prisma.facebook_event_attendees.updateMany({
        where: { id: attendee.id },
        data: { sources, updatedAt: new Date() },
      });
    }

    await this.prisma.event_facebook_links.deleteMany({ where: { id: link.id } });

    await this.audit.log({
      userId: actorId,
      action: 'facebook.event_unlink',
      entityType: 'event',
      entityId: eventId,
      metadata: { facebookEventId },
    });

    return { success: true };
  }

  // ---- invite links ----------------------------------------------------

  /**
   * The event's share links: the active one per flavour, plus every link made.
   *
   * "Active" is the newest unrevoked, unexpired one. Returning the newest
   * rather than the first is what makes re-posting after a revoke work --
   * revoking a leaked link and creating another must change what Muse posts.
   */
  async inviteLinks(eventId: number) {
    const all = await this.invites.findByEvent(eventId);
    const appUrl = await this.tenants.baseUrlFor();
    const now = Date.now();

    const views = all.map((invite) => ({
      id: invite.id,
      flavor: invite.inviteFlavor,
      token: invite.token,
      url: `${appUrl}/join/${invite.token}`,
      expiresAt: invite.expiresAt,
      isRevoked: invite.isRevoked,
      createdAt: invite.createdAt,
    }));

    const activeOf = (flavor: string) =>
      views.find(
        (view) =>
          view.flavor === flavor && !view.isRevoked && view.expiresAt.getTime() > now,
      ) ?? null;

    return {
      member: activeOf(InviteFlavor.MEMBER),
      nonValidated: activeOf(InviteFlavor.NON_VALIDATED),
      all: views,
    };
  }

  async createInviteLink(eventId: number, flavor: string | undefined, actorUserId: number) {
    const account = await this.prisma.users.findFirst({ where: { id: actorUserId } });
    if (account === null) throw new NotFoundException('Integration account not found.');

    const chosen =
      flavor === InviteFlavor.MEMBER ? InviteFlavor.MEMBER : InviteFlavor.NON_VALIDATED;

    const invite = await this.invites.createEventInvite(eventId, chosen, account);
    const appUrl = await this.tenants.baseUrlFor();

    await this.audit.log({
      userId: actorUserId,
      action: 'muse.invite_create',
      entityType: 'event',
      entityId: eventId,
      metadata: { flavor: chosen, inviteId: invite.id },
    });

    return {
      id: invite.id,
      flavor: invite.inviteFlavor,
      token: invite.token,
      url: `${appUrl}/join/${invite.token}`,
      expiresAt: invite.expiresAt,
      isRevoked: false,
      createdAt: invite.createdAt,
    };
  }

  async revokeInviteLink(
    eventId: number,
    inviteId: number,
    actorId: number,
  ): Promise<{ success: true }> {
    // Scoped read, and it must belong to THIS event -- the contract promises a
    // 404 otherwise, and revoking another dinner's link by guessing an id is
    // the thing that check prevents.
    const invite = await this.prisma.invites.findFirst({
      where: { id: inviteId, eventId },
      select: { id: true },
    });
    if (invite === null) throw new NotFoundException('That link does not belong to this event.');

    await this.invites.revoke(inviteId);

    await this.audit.log({
      userId: actorId,
      action: 'muse.invite_revoke',
      entityType: 'event',
      entityId: eventId,
      metadata: { inviteId },
    });

    return { success: true };
  }

  // ---- the sync --------------------------------------------------------

  sync(dto: FacebookSyncDto, actorId: number): Promise<SyncReport> {
    return this.facebookSync.sync(dto, actorId);
  }

  // ---- helpers ---------------------------------------------------------

  /** Each event's Facebook events, in the contract's shape. */
  private async linksFor(eventIds: readonly number[]): Promise<Map<number, MuseFacebookEvent[]>> {
    const out = new Map<number, MuseFacebookEvent[]>();
    if (eventIds.length === 0) return out;

    const links = await this.prisma.event_facebook_links.findMany({
      where: { eventId: { in: [...eventIds] } },
      orderBy: [{ id: 'asc' }],
      select: {
        eventId: true,
        facebookEventId: true,
        facebookGroup: true,
        lastSyncedAt: true,
        lastGoingCount: true,
      },
    });

    for (const link of links) {
      const view: MuseFacebookEvent = {
        facebookEventId: link.facebookEventId,
        group: link.facebookGroup,
        url: `https://www.facebook.com/events/${link.facebookEventId}/`,
        lastSyncedAt: link.lastSyncedAt,
        lastGoingCount: link.lastGoingCount,
      };
      out.set(link.eventId, [...(out.get(link.eventId) ?? []), view]);
    }

    return out;
  }
}

function asNames(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : [];
}

/** Named +1s, then one `null` per unnamed +1 -- the contract's shape. */
function withUnnamed(names: string[], total: number): (string | null)[] {
  const unnamed = Math.max(0, total - names.length);
  return [...names, ...Array.from({ length: unnamed }, () => null)];
}

/**
 * `sources` is a JSON column, read back defensively and re-typed so Prisma will
 * accept the narrowed value on the way out -- `Record<string, unknown>` is not
 * assignable to its JSON input.
 */
function asSourceMap(value: unknown): Record<string, { names: string[]; total: number }> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};

  const out: Record<string, { names: string[]; total: number }> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as { names?: unknown; total?: unknown };
    out[key] = {
      names: Array.isArray(record.names)
        ? record.names.filter((name): name is string => typeof name === 'string')
        : [],
      total: typeof record.total === 'number' ? record.total : 0,
    };
  }
  return out;
}

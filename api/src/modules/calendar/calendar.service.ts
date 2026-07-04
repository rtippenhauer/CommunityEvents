import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, IsNull, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { UserEntity } from '../../database/entities/user.entity';
import { EventEntity, EventStatus } from '../../database/entities/event.entity';
import { EventRsvpEntity, RsvpStatus } from '../../database/entities/event-rsvp.entity';

export interface CalendarSettingsResponse {
  url: string;
  cityFilter: 'all' | 'city';
  rsvpOnly: boolean;
  autoInvite: 'none' | 'city' | 'all';
  cityName: string;
}

interface CacheEntry {
  ics: string;
  expiresAt: number;
}

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly userTokenMap = new Map<number, string>();
  private readonly TTL_MS = 15 * 60 * 1000;

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(EventEntity)
    private readonly eventRepo: Repository<EventEntity>,
    @InjectRepository(EventRsvpEntity)
    private readonly rsvpRepo: Repository<EventRsvpEntity>,
    private readonly config: ConfigService,
  ) {}

  // ── Token management ────────────────────────────────────────────────────────

  async getOrCreateToken(userId: number): Promise<string> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.calendarToken) return user.calendarToken;

    const token = randomUUID();
    await this.userRepo.update(userId, { calendarToken: token });
    this.userTokenMap.set(userId, token);
    return token;
  }

  async regenerateToken(userId: number): Promise<string> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.calendarToken) {
      this.cache.delete(user.calendarToken);
      this.userTokenMap.delete(userId);
    }

    const token = randomUUID();
    await this.userRepo.update(userId, { calendarToken: token });
    this.userTokenMap.set(userId, token);
    return token;
  }

  feedUrl(token: string): string {
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    return `${appUrl}/api/v1/calendar/feed.ics?token=${token}`;
  }

  // ── Settings ─────────────────────────────────────────────────────────────────

  async getSettings(userId: number): Promise<CalendarSettingsResponse> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['city'],
    });
    if (!user) throw new NotFoundException('User not found');

    const token = await this.getOrCreateToken(userId);
    return {
      url: this.feedUrl(token),
      cityFilter: user.calendarCityFilter ?? 'all',
      rsvpOnly: user.calendarRsvpOnly ?? false,
      autoInvite: user.calendarAutoInvite ?? 'none',
      cityName: user.city?.name ?? 'My city',
    };
  }

  async updateSettings(
    userId: number,
    dto: { cityFilter?: 'all' | 'city'; rsvpOnly?: boolean; autoInvite?: 'none' | 'city' | 'all' },
  ): Promise<CalendarSettingsResponse> {
    const updates: Partial<UserEntity> = {};
    if (dto.cityFilter !== undefined) updates.calendarCityFilter = dto.cityFilter;
    if (dto.rsvpOnly !== undefined) updates.calendarRsvpOnly = dto.rsvpOnly;
    if (dto.autoInvite !== undefined) updates.calendarAutoInvite = dto.autoInvite;

    if (Object.keys(updates).length > 0) {
      await this.userRepo.update(userId, updates);
      this.invalidateForUser(userId);
    }

    return this.getSettings(userId);
  }

  // ── Feed generation ──────────────────────────────────────────────────────────

  async getFeed(token: string): Promise<string> {
    const cached = this.cache.get(token);
    if (cached && cached.expiresAt > Date.now()) return cached.ics;

    const user = await this.userRepo.findOne({ where: { calendarToken: token } });
    if (!user) throw new UnauthorizedException('Invalid calendar token');

    const ics = await this.buildFeed(user);
    this.cache.set(token, { ics, expiresAt: Date.now() + this.TTL_MS });
    this.userTokenMap.set(user.id, token);
    return ics;
  }

  private appName(): string {
    const url = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    return url.includes('stage') ? 'DinnerBears - Stage' : 'DinnerBears';
  }

  private organizerEmail(): string {
    const override = this.config.get<string>('CALENDAR_ORGANIZER_EMAIL', '');
    if (override) return override;
    const url = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    return url.includes('stage') ? 'calendar-stage@dinnerbears.com' : 'calendar@dinnerbears.com';
  }

  private async buildFeed(user: UserEntity): Promise<string> {
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');

    const rsvps = await this.rsvpRepo.find({
      where: { userId: user.id },
      select: ['eventId', 'status'],
    });
    const rsvpMap = new Map(rsvps.map((r) => [r.eventId, r.status]));

    const today = new Date().toISOString().split('T')[0];

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoffDate = sevenDaysAgo.toISOString().split('T')[0];

    const cityFilter = user.calendarCityFilter ?? 'all';
    const rsvpOnly = user.calendarRsvpOnly ?? false;

    let qb = this.eventRepo
      .createQueryBuilder('e')
      .where(
        '((e.status = :published AND e.eventDate >= :today) OR (e.status = :cancelled AND e.eventDate >= :cutoff))',
        { published: EventStatus.PUBLISHED, cancelled: EventStatus.CANCELLED, today, cutoff: cutoffDate },
      )
      .orderBy('e.eventDate', 'ASC')
      .addOrderBy('e.eventTime', 'ASC');

    if (cityFilter === 'city') {
      qb = qb.andWhere('e.cityId = :cityId', { cityId: user.cityId });
    }

    let events = await qb.getMany();

    if (rsvpOnly) {
      events = events.filter((e) => rsvpMap.has(e.id));
    }

    if (events.length === 0) return this.emptyFeed();

    const vevents = events.map((e) => this.buildVEvent(e, rsvpMap.get(e.id) ?? null, user, appUrl));

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//DinnerBears//DinnerBears Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      this.fold(`X-WR-CALNAME:${this.appName()} — ${user.fullName}`),
      'X-WR-CALDESC:Your upcoming DinnerBears dinners',
      'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
      'X-PUBLISHED-TTL:PT15M',
      'X-WR-TIMEZONE:America/New_York',
      ...vevents.flat(),
      'END:VCALENDAR',
    ];

    return lines.join('\r\n');
  }

  private buildVEvent(
    event: EventEntity,
    rsvpStatus: string | null,
    user: UserEntity,
    appUrl: string,
  ): string[] {
    const esc = (s: string) =>
      s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

    const startUtc = this.eventToUtc(event.eventDate, event.eventTime);
    const endUtc = new Date(startUtc.getTime() + 2 * 60 * 60 * 1000);
    const dtStart = this.toIcsUtc(startUtc);
    const dtEnd = this.toIcsUtc(endUtc);
    const lastMod = this.toIcsUtc(new Date(event.updatedAt));
    const sequence = Math.floor(new Date(event.updatedAt).getTime() / 60000) % 999999;

    const isCancelled = event.status === EventStatus.CANCELLED;

    const [y, m, d] = event.eventDate.split('-').map(Number);
    const [h, min] = event.eventTime.split(':').map(Number);
    const dayName = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long' });
    const monthName = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long' });
    const hour12 = h % 12 || 12;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const timeStr = `${hour12}:${String(min).padStart(2, '0')} ${ampm} ET`;

    const rsvpLine = rsvpStatus
      ? `🤝 Your RSVP: ${{ going: 'GOING', maybe: 'MAYBE', not_going: 'NOT GOING' }[rsvpStatus] ?? rsvpStatus.toUpperCase()}`
      : `👉 RSVP now: ${appUrl}/events/${event.id}`;

    const description = [
      'DinnerBears Dinner',
      '',
      `🍽 ${event.restaurantName}`,
      event.restaurantAddress || '',
      '',
      `📅 ${dayName}, ${monthName} ${d} at ${timeStr}`,
      '',
      rsvpLine,
      '',
      `View details: ${appUrl}/events/${event.id}`,
      '',
      '---',
      'Questions? Reply to hello@dinnerbears.com',
      'To manage your calendar subscription, visit your DinnerBears account settings.',
    ].filter(Boolean).join('\n');

    const location = event.restaurantAddress
      ? `${event.restaurantName}, ${event.restaurantAddress}`
      : event.restaurantName;

    const lines = [
      'BEGIN:VEVENT',
      `UID:dinnerbears-event-${event.id}@dinnerbears.com`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `LAST-MODIFIED:${lastMod}`,
      `SEQUENCE:${sequence}`,
      this.fold(`SUMMARY:${esc(isCancelled ? `[CANCELLED] ${event.restaurantName}` : `DinnerBears Dinner at ${event.restaurantName}`)}`),
      this.fold(`LOCATION:${esc(location)}`),
      this.fold(`DESCRIPTION:${esc(description)}`),
      this.fold(`URL:${appUrl}/events/${event.id}`),
      `ORGANIZER;CN=DinnerBears:mailto:${this.organizerEmail()}`,
      `STATUS:${isCancelled ? 'CANCELLED' : 'CONFIRMED'}`,
      'END:VEVENT',
    ];

    return lines;
  }

  private emptyFeed(): string {
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//DinnerBears//DinnerBears Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${this.appName()}`,
      'X-WR-CALDESC:Your upcoming DinnerBears dinners',
      'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
      'X-PUBLISHED-TTL:PT15M',
      'END:VCALENDAR',
    ].join('\r\n');
  }

  // ── Cache invalidation ────────────────────────────────────────────────────────

  invalidateForUser(userId: number): void {
    const token = this.userTokenMap.get(userId);
    if (token) this.cache.delete(token);
  }

  async invalidateAll(): Promise<void> {
    const users = await this.userRepo.find({
      where: { calendarToken: Not(IsNull()) },
      select: ['id'],
    });
    for (const u of users) this.invalidateForUser(u.id);
  }

  // ── iCal helpers ─────────────────────────────────────────────────────────────

  private eventToUtc(dateStr: string, timeStr: string): Date {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [h, min] = timeStr.split(':').map(Number);

    const approx = new Date(Date.UTC(y, m - 1, d, h, min, 0));
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(approx);
    const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
    const easternH = get('hour') % 24;
    const easternMin = get('minute');
    const diffMin = (h * 60 + min) - (easternH * 60 + easternMin);
    return new Date(approx.getTime() + diffMin * 60 * 1000);
  }

  private toIcsUtc(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
      `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
    );
  }

  private fold(line: string): string {
    const bytes = Buffer.from(line, 'utf-8');
    if (bytes.length <= 75) return line;

    const parts: string[] = [];
    let pos = 0;
    let first = true;

    while (pos < bytes.length) {
      const limit = first ? 75 : 74;
      let end = Math.min(pos + limit, bytes.length);
      while (end > pos && (bytes[end] & 0xc0) === 0x80) end--;
      parts.push(bytes.slice(pos, end).toString('utf-8'));
      pos = end;
      first = false;
    }

    return parts.join('\r\n ');
  }

  // ── Email attachment (.ics for Phase 16b) ────────────────────────────────────

  buildInviteAttachment(
    event: EventEntity,
    recipient: { name: string; email: string },
    appUrl: string,
  ): string {
    const esc = (s: string) =>
      s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

    const startUtc = this.eventToUtc(event.eventDate, event.eventTime);
    const endUtc = new Date(startUtc.getTime() + 2 * 60 * 60 * 1000);
    const dtStart = this.toIcsUtc(startUtc);
    const dtEnd = this.toIcsUtc(endUtc);
    const lastMod = this.toIcsUtc(new Date(event.updatedAt));
    const sequence = Math.floor(new Date(event.updatedAt).getTime() / 60000) % 999999;

    const [y, m, d] = event.eventDate.split('-').map(Number);
    const [h, min] = event.eventTime.split(':').map(Number);
    const dayName = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long' });
    const monthName = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long' });
    const hour12 = h % 12 || 12;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const timeStr = `${hour12}:${String(min).padStart(2, '0')} ${ampm} ET`;

    const description = [
      'DinnerBears Dinner',
      '',
      `🍽 ${event.restaurantName}`,
      event.restaurantAddress || '',
      '',
      `📅 ${dayName}, ${monthName} ${d} at ${timeStr}`,
      '',
      `View details and RSVP: ${appUrl}/events/${event.id}`,
      '',
      '---',
      'Questions? Reply to hello@dinnerbears.com',
    ].join('\n');

    const location = event.restaurantAddress
      ? `${event.restaurantName}, ${event.restaurantAddress}`
      : event.restaurantName;

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//DinnerBears//DinnerBears Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      `UID:dinnerbears-event-${event.id}@dinnerbears.com`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `LAST-MODIFIED:${lastMod}`,
      `SEQUENCE:${sequence}`,
      this.fold(`SUMMARY:${esc(`DinnerBears Dinner at ${event.restaurantName}`)}`),
      this.fold(`LOCATION:${esc(location)}`),
      this.fold(`DESCRIPTION:${esc(description)}`),
      this.fold(`URL:${appUrl}/events/${event.id}`),
      `ORGANIZER;CN=DinnerBears:mailto:${this.organizerEmail()}`,
      this.fold(`ATTENDEE;CN=${esc(recipient.name)};RSVP=TRUE:mailto:${recipient.email}`),
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
    ];

    return lines.join('\r\n');
  }

  // ── Inbound reply processing (Phase 16c) ─────────────────────────────────────

  async processRsvpReply(rawEmail: string): Promise<void> {
    const ical = this.extractIcalFromEmail(rawEmail);
    if (!ical) {
      this.logger.warn('rsvp-reply: no iCal block found in email');
      return;
    }

    if (!/METHOD:REPLY/i.test(ical)) {
      this.logger.debug('rsvp-reply: not a METHOD:REPLY, ignoring');
      return;
    }

    const uidMatch = ical.match(/UID:dinnerbears-event-(\d+)@dinnerbears\.com/i);
    if (!uidMatch) {
      this.logger.warn('rsvp-reply: unrecognized UID format');
      return;
    }
    const eventId = parseInt(uidMatch[1], 10);

    // Unfold RFC 5545 line continuations then parse ATTENDEE
    const unfolded = ical.replace(/\r?\n[ \t]/g, '');
    const attendeeLine = unfolded.match(/^ATTENDEE[^:\r\n]*:[^\r\n]+/im)?.[0] ?? '';
    const partstatMatch = attendeeLine.match(/PARTSTAT=([A-Z-]+)/i);
    const emailMatch = attendeeLine.match(/:mailto:([^\s;,\r\n]+)/i);

    if (!partstatMatch || !emailMatch) {
      this.logger.warn(`rsvp-reply: could not parse ATTENDEE line: ${attendeeLine || '(not found)'}`);
      this.logger.debug(`rsvp-reply: iCal snippet: ${ical.slice(0, 400)}`);
      return;
    }

    const partstat = partstatMatch[1].toUpperCase();
    const attendeeEmail = emailMatch[1].trim().toLowerCase();

    const statusMap: Record<string, RsvpStatus> = {
      ACCEPTED: RsvpStatus.GOING,
      TENTATIVE: RsvpStatus.MAYBE,
      DECLINED: RsvpStatus.NOT_GOING,
    };
    const rsvpStatus = statusMap[partstat];
    if (!rsvpStatus) {
      this.logger.debug(`rsvp-reply: unhandled PARTSTAT=${partstat}, ignoring`);
      return;
    }

    const event = await this.eventRepo.findOne({ where: { id: eventId } });
    if (!event || event.status !== EventStatus.PUBLISHED) {
      this.logger.warn(`rsvp-reply: event ${eventId} not found or not published`);
      return;
    }

    const user = await this.userRepo.findOne({ where: { email: attendeeEmail } });
    if (!user) {
      this.logger.warn(`rsvp-reply: no user found for ${attendeeEmail}`);
      return;
    }

    const existing = await this.rsvpRepo.findOne({ where: { eventId, userId: user.id } });
    if (existing) {
      if (existing.status === rsvpStatus) return;
      existing.status = rsvpStatus;
      await this.rsvpRepo.save(existing);
    } else {
      await this.rsvpRepo.save(
        this.rsvpRepo.create({ eventId, userId: user.id, status: rsvpStatus, additionalGuests: 0 }),
      );
    }

    this.invalidateForUser(user.id);
    this.logger.log(`rsvp-reply: ${attendeeEmail} → ${rsvpStatus} for event ${eventId}`);
  }

  private extractIcalFromEmail(rawEmail: string): string | null {
    // Try plain-text first — also handles quoted-printable since BEGIN:VCALENDAR
    // is readable ASCII. Decode QP afterward so =3D etc. are resolved.
    const inline = rawEmail.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/i);
    if (inline) return this.decodeQuotedPrintable(inline[0]);

    // Try after full QP decode of the email (catches cases where the iCal section
    // has soft-line-break folding that obscures the BEGIN: marker)
    const qpDecoded = this.decodeQuotedPrintable(rawEmail);
    const qpMatch = qpDecoded.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/i);
    if (qpMatch) return qpMatch[0];

    // Base64-encoded MIME part
    const b64Parts = rawEmail.match(/Content-Transfer-Encoding:\s*base64[\s\S]*?(?=\n--|\n\n--|$)/gi) ?? [];
    for (const part of b64Parts) {
      const b64 = part.match(/\n\n([\w+/=\r\n]+)/)?.[1];
      if (!b64) continue;
      try {
        const decoded = Buffer.from(b64.replace(/[\r\n]/g, ''), 'base64').toString('utf-8');
        const cal = decoded.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/i);
        if (cal) return cal[0];
      } catch {
        // ignore malformed base64
      }
    }

    return null;
  }

  private decodeQuotedPrintable(str: string): string {
    return str
      .replace(/=\r?\n/g, '')  // remove QP soft line breaks
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
}

import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, IsNull, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { UserEntity } from '../../database/entities/user.entity';
import { EventEntity, EventStatus } from '../../database/entities/event.entity';
import { EventRsvpEntity } from '../../database/entities/event-rsvp.entity';

export interface CalendarSettingsResponse {
  url: string;
  cityFilter: 'all' | 'city';
  rsvpOnly: boolean;
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
      cityName: user.city?.name ?? 'My city',
    };
  }

  async updateSettings(
    userId: number,
    dto: { cityFilter?: 'all' | 'city'; rsvpOnly?: boolean },
  ): Promise<CalendarSettingsResponse> {
    const updates: Partial<UserEntity> = {};
    if (dto.cityFilter !== undefined) updates.calendarCityFilter = dto.cityFilter;
    if (dto.rsvpOnly !== undefined) updates.calendarRsvpOnly = dto.rsvpOnly;

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

  private async buildFeed(user: UserEntity): Promise<string> {
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');

    const rsvps = await this.rsvpRepo.find({
      where: { userId: user.id },
      select: ['eventId', 'status'],
    });
    const rsvpMap = new Map(rsvps.map((r) => [r.eventId, r.status]));

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoffDate = sevenDaysAgo.toISOString().split('T')[0];

    const cityFilter = user.calendarCityFilter ?? 'all';
    const rsvpOnly = user.calendarRsvpOnly ?? false;

    let qb = this.eventRepo
      .createQueryBuilder('e')
      .where(
        '(e.status = :published OR (e.status = :cancelled AND e.eventDate >= :cutoff))',
        { published: EventStatus.PUBLISHED, cancelled: EventStatus.CANCELLED, cutoff: cutoffDate },
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
      `ORGANIZER;CN=DinnerBears:mailto:noreply@dinnerbears.com`,
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
      `ORGANIZER;CN=DinnerBears:mailto:noreply@dinnerbears.com`,
      this.fold(`ATTENDEE;CN=${esc(recipient.name)};RSVP=TRUE:mailto:${recipient.email}`),
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
    ];

    return lines.join('\r\n');
  }
}

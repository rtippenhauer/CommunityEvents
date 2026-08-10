import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  Prisma,
  cities as City,
  location_photos as LocationPhoto,
  users as User,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { ImportSource } from '../../database/enums';
import { GeocodingService } from './geocoding.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { toPublicUser } from '../../common/utils/public-user.util';
import { LocationVisibilityService } from '../../common/services/location-visibility.service';
import { AppConfigService } from '../app-config/app-config.service';

// What these reads return: the row plus the relations the responses have
// always carried. The moderator-only columns stay omitted by PrismaService
// unless a caller opts back in.
type LocationRow = Prisma.locationsGetPayload<{
  include: {
    city: true;
    photos: true;
    createdByUser: true;
    updatedByUser: true;
  };
}>;

// The list reads never loaded the audit-user relations, so they return the
// narrower shape rather than pretending those fields are present.
type LocationListRow = Prisma.locationsGetPayload<{
  include: { city: true; photos: true };
}>;

export interface LocationQuery {
  cityId?: number;
  search?: string;
}

interface ImportDetail {
  name: string;
  status: 'inserted' | 'skipped' | 'error';
  reason?: string;
}

export interface ImportResult {
  inserted: number;
  skipped: number;
  errors: number;
  details: ImportDetail[];
}

interface FacebookCoordinate {
  latitude?: number;
  longitude?: number;
  lat?: number;
  lng?: number;
}

interface FacebookPlace {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  coordinate?: FacebookCoordinate;
}

interface FacebookEvent {
  name?: string;
  start_timestamp?: number;
  place?: FacebookPlace;
  location?: FacebookPlace;
  description?: string;
}

@Injectable()
export class LocationsService {
  private readonly logger = new Logger(LocationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geocodingService: GeocodingService,
    private readonly locationVisibility: LocationVisibilityService,
    private readonly appConfigService: AppConfigService,
  ) {}

  async findAll(query: LocationQuery): Promise<LocationListRow[]> {
    return this.prisma.locations.findMany({
      where: {
        isActive: true,
        ...(query.cityId ? { cityId: query.cityId } : {}),
        ...(query.search ? { name: { contains: query.search } } : {}),
      },
      // photos ordered by id keeps photos[0] ("the cover photo" in list
      // thumbnails) consistent with findOne's ordering below.
      include: { city: true, photos: { orderBy: { id: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  // Member-facing reads (controller GET routes). Private locations are hidden
  // from the browsable list entirely for anyone who isn't admin/mod — members
  // only encounter them contextually through an event they're attending (where
  // the address is separately gated by redact()). For privileged viewers the
  // full set is returned; redact() then still nulls address/lat/lng for anyone
  // without earned visibility.
  async findAllForUser(query: LocationQuery, user: User | null): Promise<LocationListRow[]> {
    const locations = await this.findAll(query);
    const visible = this.locationVisibility.isAdminOrMod(user)
      ? locations
      : locations.filter((l) => !l.isPrivate);
    return Promise.all(visible.map((l) => this.locationVisibility.redact(l, user)));
  }

  async findOneForUser(id: number, user: User | null): Promise<LocationRow> {
    const location = await this.findOne(id);
    return this.locationVisibility.redact(location, user);
  }

  async findAllArchived(query: LocationQuery): Promise<LocationListRow[]> {
    return this.prisma.locations.findMany({
      where: {
        isActive: false,
        ...(query.cityId ? { cityId: query.cityId } : {}),
        ...(query.search ? { name: { contains: query.search } } : {}),
      },
      include: { city: true, photos: { orderBy: { id: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: number): Promise<LocationRow> {
    const r = await this.prisma.locations.findFirst({
      where: { id, isActive: true },
      include: {
        city: true,
        photos: { orderBy: { id: 'asc' } },
        createdByUser: true,
        updatedByUser: true,
      },
    });
    if (!r) throw new NotFoundException('Restaurant not found');
    return Object.assign(r, { createdByUser: toPublicUser(r.createdByUser), updatedByUser: toPublicUser(r.updatedByUser) });
  }

  async findOneWithModFields(id: number): Promise<LocationRow> {
    // The only caller allowed to see the moderator-only columns. They are
    // hidden by a global omit in PrismaService (standing in for TypeORM's
    // `select: false`), so this is the one place that opts back in --
    // the equivalent of the addSelect this replaces.
    const r = await this.prisma.locations.findFirst({
      where: { id, isActive: true },
      omit: {
        moderatorNotes: false,
        contactName: false,
        contactPhone: false,
        contactEmail: false,
      },
      include: {
        city: true,
        photos: { orderBy: { id: 'asc' } },
        createdByUser: true,
        updatedByUser: true,
      },
    });
    if (!r) throw new NotFoundException('Restaurant not found');
    return Object.assign(r, { createdByUser: toPublicUser(r.createdByUser), updatedByUser: toPublicUser(r.updatedByUser) });
  }

  async create(dto: CreateLocationDto, userId?: number): Promise<LocationRow> {
    const coords = await this.geocodingService.geocode(dto.address);
    const isPrivate =
      dto.isPrivate ?? (await this.appConfigService.getSiteSetting('location_privacy_default')) === 'private';
    const saved = await this.prisma.locations.create({
      data: {
        ...dto,
        isPrivate,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        createdById: userId ?? null,
        updatedById: userId ?? null,
      },
    });
    return this.findOne(saved.id);
  }

  async update(id: number, dto: UpdateLocationDto | Record<string, unknown>, userId?: number): Promise<LocationRow> {
    const location = await this.findOne(id);
    const addressChanged = (dto as UpdateLocationDto).address && (dto as UpdateLocationDto).address !== location.address;

    // A patch built from the DTO, rather than the loaded row mutated and saved
    // back. findOne returns the row with its relations attached, and handing
    // that whole object to Prisma would try to write the relations too.
    // Unchecked variant: it accepts the scalar foreign keys (updatedById)
    // directly, where the checked input expects nested relation connects.
    const data: Prisma.locationsUncheckedUpdateInput = {
      ...(dto as Prisma.locationsUncheckedUpdateInput),
    };

    if (userId) data.updatedById = userId;

    if (addressChanged) {
      const coords = await this.geocodingService.geocode((dto as UpdateLocationDto).address!);
      data.lat = coords?.lat ?? null;
      data.lng = coords?.lng ?? null;
    }

    await this.prisma.locations.update({ where: { id }, data });
    return this.findOne(id);
  }

  async remove(id: number): Promise<void> {
    await this.prisma.locations.update({ where: { id }, data: { isActive: false } });
  }

  async restore(id: number): Promise<LocationRow> {
    const location = await this.prisma.locations.findFirst({ where: { id, isActive: false } });
    if (!location) throw new NotFoundException('Archived restaurant not found');
    await this.prisma.locations.update({ where: { id }, data: { isActive: true } });
    return this.findOne(id);
  }

  async addPhoto(
    locationId: number,
    file: Express.Multer.File,
    uploader: User,
  ): Promise<LocationPhoto> {
    await this.findOne(locationId);
    const maxOrder = await this.prisma.location_photos.aggregate({
      where: { locationId },
      _max: { sortOrder: true },
    });

    const url = `/api/uploads/locations/${file.filename}`;
    return this.prisma.location_photos.create({
      data: {
        locationId,
        filePath: url,
        fileName: file.filename,
        mimeType: file.mimetype,
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
        uploadedBy: uploader.id,
      },
    });
  }

  async removePhoto(locationId: number, photoId: number): Promise<void> {
    const photo = await this.prisma.location_photos.findFirst({
      where: { id: photoId, locationId },
    });
    if (!photo) throw new NotFoundException('Photo not found');
    await this.prisma.location_photos.delete({ where: { id: photo.id } });
  }

  async reorderPhotos(locationId: number, orderedIds: number[]): Promise<void> {
    // updateMany, not update: locationId is an ownership check, so a photo id
    // belonging to a different location must not be reordered.
    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.location_photos.updateMany({
          where: { id, locationId },
          data: { sortOrder: index },
        }),
      ),
    );
  }

  // ─── Facebook import ──────────────────────────────────────────────────────

  async importFacebookEvents(buffer: Buffer, cityId: number): Promise<ImportResult> {
    let json: unknown;
    try {
      json = JSON.parse(buffer.toString('utf-8')) as unknown;
    } catch {
      throw new BadRequestException('Invalid JSON file — could not parse');
    }

    const events = this.extractFacebookEvents(json);
    if (events.length === 0) {
      throw new BadRequestException(
        'No events found in the file. Expected an array or an object with a "your_events_v2" or "events" key.',
      );
    }

    const cities = await this.prisma.cities.findMany({ where: { isActive: true } });

    const existing = await this.prisma.locations.findMany({
      select: { name: true, address: true },
    });
    const existingNames = new Set(existing.map((r) => r.name.toLowerCase()));
    const existingAddresses = new Set(
      existing.filter((r) => r.address).map((r) => r.address.toLowerCase().trim()),
    );

    const details: ImportDetail[] = [];
    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    for (const event of events) {
      const place = event.place ?? event.location;
      const eventTitle = event.name?.trim() ?? '';

      const name = this.extractLocationName(eventTitle);
      if (!name) {
        if (eventTitle) {
          this.logger.log(`[FB Import] Skipping — no pattern match: "${eventTitle}"`);
          details.push({ name: eventTitle, status: 'skipped', reason: 'Does not match expected event title pattern' });
          skipped++;
        }
        continue;
      }

      const address = this.extractFacebookAddress(place);
      if (!address) {
        details.push({ name, status: 'skipped', reason: 'No address in event' });
        skipped++;
        continue;
      }

      if (existingNames.has(name.toLowerCase())) {
        details.push({ name, status: 'skipped', reason: 'Already exists (name)' });
        skipped++;
        continue;
      }

      if (existingAddresses.has(address.toLowerCase().trim())) {
        details.push({ name, status: 'skipped', reason: 'Already exists (address)' });
        skipped++;
        continue;
      }

      let lat: number | null = null;
      let lng: number | null = null;
      const coord = place?.coordinate;
      if (coord) {
        lat = coord.latitude ?? coord.lat ?? null;
        lng = coord.longitude ?? coord.lng ?? null;
      }
      if (!lat || !lng) {
        const coords = await this.geocodingService.geocode(address);
        if (coords) {
          lat = coords.lat;
          lng = coords.lng;
          await new Promise((r) => setTimeout(r, 150));
        }
      }

      const resolvedCityId = this.detectCity(address, cities, cityId);
      const websiteUrl = this.extractLocationUrl(event.description);
      const description = event.description?.trim().slice(0, 2000) || null;

      try {
        await this.prisma.locations.create({
          data: {
            name,
            address,
            cityId: resolvedCityId,
            description,
            websiteUrl,
            lat,
            lng,
            importedFrom: ImportSource.FACEBOOK_IMPORT,
            isActive: true,
          },
        });
        existingNames.add(name.toLowerCase());
        existingAddresses.add(address.toLowerCase().trim());
        details.push({ name, status: 'inserted' });
        inserted++;
      } catch (err) {
        details.push({ name, status: 'error', reason: (err as Error).message });
        errors++;
      }
    }

    return { inserted, skipped, errors, details };
  }

  // Splits event title on word-boundary "at"; finds the first split where the
  // left side has a group keyword (bears, dinner, night…) and right side does not.
  // Handles: "Monthly Bear Dinner at Cincinnati Bears in Dayton at El Rancho" → "El Rancho"
  private extractLocationName(title: string): string | null {
    const groupKeywords = /\b(?:bears?|dinner|night|evening|monthly|weekly)\b/i;
    const parts = title.split(/\bat\b/i);
    if (parts.length === 1) return null;

    let foundGroupPrefix = false;
    for (let i = 1; i < parts.length; i++) {
      const prefix = parts.slice(0, i).map((p) => p.trim()).filter(Boolean).join(' at ');
      const suffix = parts.slice(i).map((p) => p.trim()).filter(Boolean).join(' at ').replace(/^[\s,;:]+/, '');

      if (!groupKeywords.test(prefix)) continue;
      foundGroupPrefix = true;
      if (groupKeywords.test(suffix)) continue;

      return suffix.length > 0 ? suffix : null;
    }

    if (foundGroupPrefix) {
      const last = parts[parts.length - 1].replace(/^[\s,;:]+/, '').trim();
      return last.length > 0 ? last : null;
    }

    return null;
  }

  private extractLocationUrl(description: string | undefined | null): string | null {
    if (!description) return null;
    const matches = description.match(/https?:\/\/[^\s,)>"']+/gi);
    if (!matches) return null;
    for (const url of matches) {
      const lower = url.toLowerCase();
      if (!lower.includes('facebook.com') && !lower.includes('fb.me') && !lower.includes('fb.com')) {
        return url.replace(/[.,!?;:]+$/, '');
      }
    }
    return null;
  }

  private detectCity(address: string, cities: City[], defaultCityId: number): number {
    const lower = address.toLowerCase();
    for (const city of cities) {
      if (lower.includes(city.name.toLowerCase())) return city.id;
    }
    return defaultCityId;
  }

  private extractFacebookEvents(json: unknown): FacebookEvent[] {
    if (Array.isArray(json)) return json as FacebookEvent[];
    if (typeof json !== 'object' || json === null) return [];
    const obj = json as Record<string, unknown>;
    for (const key of ['your_events_v2', 'events', 'events_v2', 'group_events', 'event_invites']) {
      if (Array.isArray(obj[key])) return obj[key] as FacebookEvent[];
    }
    for (const val of Object.values(obj)) {
      if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
        return val as FacebookEvent[];
      }
    }
    return [];
  }

  private extractFacebookAddress(place: FacebookPlace | undefined): string | null {
    if (!place) return null;
    if (place.address) return place.address.trim();
    const parts = [place.city, place.state].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }
}

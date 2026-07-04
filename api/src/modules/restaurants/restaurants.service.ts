import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { RestaurantEntity, ImportSource } from '../../database/entities/restaurant.entity';
import { RestaurantPhotoEntity } from '../../database/entities/restaurant-photo.entity';
import { CityEntity } from '../../database/entities/city.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { GeocodingService } from './geocoding.service';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { extname } from 'path';
import { toPublicUser } from '../../common/utils/public-user.util';

export interface RestaurantQuery {
  cityId?: number;
  search?: string;
}

export interface ImportDetail {
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
export class RestaurantsService {
  private readonly logger = new Logger(RestaurantsService.name);

  constructor(
    @InjectRepository(RestaurantEntity)
    private readonly restaurantRepo: Repository<RestaurantEntity>,
    @InjectRepository(RestaurantPhotoEntity)
    private readonly photoRepo: Repository<RestaurantPhotoEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
    private readonly geocodingService: GeocodingService,
  ) {}

  async findAll(query: RestaurantQuery): Promise<RestaurantEntity[]> {
    const where: Record<string, unknown> = { isActive: true };
    if (query.cityId) where['cityId'] = query.cityId;
    if (query.search) where['name'] = Like(`%${query.search}%`);

    return this.restaurantRepo.find({
      where,
      relations: ['city', 'photos'],
      order: { name: 'ASC' },
    });
  }

  async findOne(id: number): Promise<RestaurantEntity> {
    const r = await this.restaurantRepo.findOne({
      where: { id, isActive: true },
      relations: ['city', 'photos', 'createdByUser', 'updatedByUser'],
    });
    if (!r) throw new NotFoundException('Restaurant not found');
    return Object.assign(r, { createdByUser: toPublicUser(r.createdByUser), updatedByUser: toPublicUser(r.updatedByUser) });
  }

  async findOneWithModFields(id: number): Promise<RestaurantEntity> {
    const r = await this.restaurantRepo
      .createQueryBuilder('r')
      .addSelect(['r.moderatorNotes', 'r.contactName', 'r.contactPhone', 'r.contactEmail'])
      .leftJoinAndSelect('r.city', 'city')
      .leftJoinAndSelect('r.photos', 'photos')
      .leftJoinAndSelect('r.createdByUser', 'createdByUser')
      .leftJoinAndSelect('r.updatedByUser', 'updatedByUser')
      .where('r.id = :id AND r.isActive = 1', { id })
      .getOne();
    if (!r) throw new NotFoundException('Restaurant not found');
    return Object.assign(r, { createdByUser: toPublicUser(r.createdByUser), updatedByUser: toPublicUser(r.updatedByUser) });
  }

  async create(dto: CreateRestaurantDto, userId?: number): Promise<RestaurantEntity> {
    const coords = await this.geocodingService.geocode(dto.address);
    const restaurant = this.restaurantRepo.create({
      ...dto,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      createdById: userId ?? null,
      updatedById: userId ?? null,
    });
    const saved = await this.restaurantRepo.save(restaurant);
    return this.findOne(saved.id);
  }

  async update(id: number, dto: UpdateRestaurantDto | Record<string, unknown>, userId?: number): Promise<RestaurantEntity> {
    const restaurant = await this.findOne(id);
    const addressChanged = (dto as UpdateRestaurantDto).address && (dto as UpdateRestaurantDto).address !== restaurant.address;

    Object.assign(restaurant, dto);

    if (userId) restaurant.updatedById = userId;

    if (addressChanged) {
      const coords = await this.geocodingService.geocode((dto as UpdateRestaurantDto).address!);
      restaurant.lat = coords?.lat ?? null;
      restaurant.lng = coords?.lng ?? null;
    }

    await this.restaurantRepo.save(restaurant);
    return this.findOne(id);
  }

  async remove(id: number): Promise<void> {
    await this.restaurantRepo.update(id, { isActive: false });
  }

  async addPhoto(
    restaurantId: number,
    file: Express.Multer.File,
    uploader: UserEntity,
  ): Promise<RestaurantPhotoEntity> {
    await this.findOne(restaurantId);
    const maxOrder = await this.photoRepo
      .createQueryBuilder('p')
      .select('MAX(p.sort_order)', 'max')
      .where('p.restaurant_id = :restaurantId', { restaurantId })
      .getRawOne<{ max: number | null }>();

    const url = `/api/uploads/${file.filename}`;
    const photo = this.photoRepo.create({
      restaurantId,
      filePath: url,
      fileName: file.filename,
      mimeType: file.mimetype,
      sortOrder: (maxOrder?.max ?? -1) + 1,
      uploadedBy: uploader.id,
    });
    return this.photoRepo.save(photo);
  }

  async removePhoto(restaurantId: number, photoId: number): Promise<void> {
    const photo = await this.photoRepo.findOne({
      where: { id: photoId, restaurantId },
    });
    if (!photo) throw new NotFoundException('Photo not found');
    await this.photoRepo.remove(photo);
  }

  async reorderPhotos(restaurantId: number, orderedIds: number[]): Promise<void> {
    await Promise.all(
      orderedIds.map((id, index) =>
        this.photoRepo.update({ id, restaurantId }, { sortOrder: index }),
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

    const cities = await this.cityRepo.find({ where: { isActive: true } });

    const existing = await this.restaurantRepo.find({ select: ['name', 'address'] });
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

      const name = this.extractRestaurantName(eventTitle);
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
      const websiteUrl = this.extractRestaurantUrl(event.description);
      const description = event.description?.trim().slice(0, 2000) || null;

      try {
        const restaurant = this.restaurantRepo.create({
          name,
          address,
          cityId: resolvedCityId,
          description,
          websiteUrl,
          lat,
          lng,
          importedFrom: ImportSource.FACEBOOK_IMPORT,
          isActive: true,
        });
        await this.restaurantRepo.save(restaurant);
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
  private extractRestaurantName(title: string): string | null {
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

  private extractRestaurantUrl(description: string | undefined | null): string | null {
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

  private detectCity(address: string, cities: CityEntity[], defaultCityId: number): number {
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

// re-export for use in controller
export { extname };

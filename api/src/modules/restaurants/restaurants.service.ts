import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { RestaurantEntity } from '../../database/entities/restaurant.entity';
import { RestaurantPhotoEntity } from '../../database/entities/restaurant-photo.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { GeocodingService } from './geocoding.service';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { extname } from 'path';

export interface RestaurantQuery {
  cityId?: number;
  search?: string;
}

@Injectable()
export class RestaurantsService {
  constructor(
    @InjectRepository(RestaurantEntity)
    private readonly restaurantRepo: Repository<RestaurantEntity>,
    @InjectRepository(RestaurantPhotoEntity)
    private readonly photoRepo: Repository<RestaurantPhotoEntity>,
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
      relations: ['city', 'photos'],
    });
    if (!r) throw new NotFoundException('Restaurant not found');
    return r;
  }

  async create(dto: CreateRestaurantDto): Promise<RestaurantEntity> {
    const coords = await this.geocodingService.geocode(dto.address);
    const restaurant = this.restaurantRepo.create({
      ...dto,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
    });
    const saved = await this.restaurantRepo.save(restaurant);
    return this.findOne(saved.id);
  }

  async update(id: number, dto: UpdateRestaurantDto): Promise<RestaurantEntity> {
    const restaurant = await this.findOne(id);
    const addressChanged = dto.address && dto.address !== restaurant.address;

    Object.assign(restaurant, dto);

    if (addressChanged) {
      const coords = await this.geocodingService.geocode(dto.address!);
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
}

// re-export for use in controller
export { extname };

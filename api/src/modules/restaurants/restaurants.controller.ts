import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage, memoryStorage } from 'multer';
import type { Request } from 'express';
import type { FileFilterCallback } from 'multer';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';
import { RestaurantsService } from './restaurants.service';
import { RatingsService } from './ratings.service';
import { EnrichmentService } from './enrichment.service';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { CreateRatingDto } from './dto/create-rating.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity, UserRole } from '../../database/entities/user.entity';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp'];

const photoStorage = diskStorage({
  destination: (
    _req: Request,
    _file: Express.Multer.File,
    cb: (err: Error | null, dest: string) => void,
  ) => {
    const dest = join(process.env.UPLOAD_PATH ?? '/app/uploads', 'restaurants');
    mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (
    _req: Request,
    file: Express.Multer.File,
    cb: (err: Error | null, name: string) => void,
  ) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${extname(file.originalname)}`);
  },
});

const photoFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback): void => {
  const ext = extname(file.originalname).toLowerCase();
  if (ALLOWED_MIME.includes(file.mimetype) && ALLOWED_EXT.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
  }
};

const jsonFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback): void => {
  const ext = extname(file.originalname).toLowerCase();
  const allowedMime = ['application/json', 'text/plain', 'application/octet-stream'];
  if (allowedMime.includes(file.mimetype) && (ext === '.json' || ext === '.txt')) {
    cb(null, true);
  } else {
    cb(new Error('Only .json files are accepted'));
  }
};

@Controller('restaurants')
@UseGuards(JwtAuthGuard)
export class RestaurantsController {
  constructor(
    private readonly restaurantsService: RestaurantsService,
    private readonly ratingsService: RatingsService,
    private readonly enrichmentService: EnrichmentService,
  ) {}

  // Must be declared before :id routes to avoid route collision
  @Post('import/facebook')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: jsonFilter,
    }),
  )
  importFacebook(
    @UploadedFile() file: Express.Multer.File,
    @Query('cityId') cityId: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const id = parseInt(cityId, 10);
    if (!id) throw new BadRequestException('cityId query parameter is required');
    return this.restaurantsService.importFacebookEvents(file.buffer, id);
  }

  @Get('place-search')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  placeSearch(@Query('q') q: string) {
    if (!q?.trim()) return [];
    return this.enrichmentService.placeSearch(q.trim());
  }

  @Get()
  findAll(@Query('cityId') cityId?: string, @Query('search') search?: string) {
    return this.restaurantsService.findAll({
      cityId: cityId ? parseInt(cityId, 10) : undefined,
      search,
    });
  }

  @Get('rating-queue')
  @UseGuards(JwtAuthGuard)
  getRatingQueue(@CurrentUser() user: UserEntity) {
    return this.ratingsService.getRatingQueue(user.id);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserEntity,
  ) {
    const isModOrAdmin = user.role === UserRole.ADMIN || user.role === UserRole.MODERATOR;
    return isModOrAdmin
      ? this.restaurantsService.findOneWithModFields(id)
      : this.restaurantsService.findOne(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  create(@Body() dto: CreateRestaurantDto, @CurrentUser() user: UserEntity) {
    return this.restaurantsService.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRestaurantDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.restaurantsService.update(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.restaurantsService.remove(id);
  }

  @Post(':id/photos')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: photoStorage,
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: photoFilter,
    }),
  )
  addPhoto(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: UserEntity,
  ) {
    return this.restaurantsService.addPhoto(id, file, user);
  }

  @Delete(':id/photos/:photoId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  removePhoto(
    @Param('id', ParseIntPipe) id: number,
    @Param('photoId', ParseIntPipe) photoId: number,
  ) {
    return this.restaurantsService.removePhoto(id, photoId);
  }

  @Get(':id/enrich/diagnose')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async enrichDiagnose(@Param('id', ParseIntPipe) id: number) {
    const restaurant = await this.restaurantsService.findOne(id);
    return this.enrichmentService.diagnose(restaurant);
  }

  @Post(':id/enrich')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async enrich(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserEntity,
  ) {
    const restaurant = await this.restaurantsService.findOne(id);
    const enrichResult = await this.enrichmentService.enrich(restaurant, user.id);
    return {
      ...enrichResult,
      restaurant: await this.restaurantsService.findOne(id),
    };
  }

  @Post('enrich/bulk')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async enrichBulk(@CurrentUser() user: UserEntity) {
    const restaurants = await this.restaurantsService.findAll({});
    void this.enrichmentService.bulkEnrich(restaurants, user.id);
    return { started: true, total: restaurants.length };
  }

  // ── Ratings ──────────────────────────────────────────────────────────────────

  @Get(':id/ratings')
  getRatings(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserEntity,
  ) {
    return this.ratingsService.getRatings(id, user);
  }

  @Post(':id/ratings')
  submitRating(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateRatingDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.ratingsService.submitRating(id, user, dto);
  }
}

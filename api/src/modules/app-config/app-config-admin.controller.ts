import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import type { FileFilterCallback } from 'multer';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';
import { AppConfigService } from './app-config.service';
import { UpdateAppConfigDto } from './dto/update-app-config.dto';
import { BulkUpdateAppConfigDto } from './dto/bulk-update-app-config.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity, UserRole } from '../../database/entities/user.entity';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

// Maps the :slot route param to its app_config key. The frontend falls back to
// its compiled-in default asset whenever the stored value is empty.
const BRAND_IMAGE_SLOTS: Record<
  string,
  'brand_logo_url' | 'brand_splash_url' | 'brand_icon_url' | 'brand_story_url'
> = {
  logo: 'brand_logo_url',
  splash: 'brand_splash_url',
  icon: 'brand_icon_url',
  story: 'brand_story_url',
};

const brandImageStorage = diskStorage({
  destination: (_req, _file, cb) => {
    const dest = join(process.env.UPLOAD_PATH ?? '/app/uploads', 'branding');
    mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${extname(file.originalname)}`);
  },
});

const imageFilter = (
  _req: any,
  file: Express.Multer.File,
  cb: FileFilterCallback,
): void => {
  const ext = extname(file.originalname).toLowerCase();
  if (ALLOWED_MIME.includes(file.mimetype) && ALLOWED_EXT.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'));
  }
};

@Controller('admin/config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AppConfigAdminController {
  constructor(private readonly appConfigService: AppConfigService) {}

  @Get('legal')
  getLegalConfig() {
    return this.appConfigService.getLegalConfig();
  }

  @Get('site-settings')
  getSiteSettings() {
    return this.appConfigService.getSiteSettings();
  }

  // Uploads a brand image (logo | splash | icon), stores it under
  // /api/uploads/branding/, and records the resulting path in the matching
  // app_config row. The unique filename doubles as cache-busting — a new
  // upload yields a new URL, so clients never serve a stale cached image.
  @Post('branding/image/:slot')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: brandImageStorage,
      fileFilter: imageFilter,
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadBrandImage(
    @Param('slot') slot: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: UserEntity,
  ) {
    const key = BRAND_IMAGE_SLOTS[slot];
    if (!key) throw new BadRequestException('Unknown brand image slot');
    if (!file) throw new BadRequestException('No image uploaded');
    const url = `/api/uploads/branding/${file.filename}`;
    await this.appConfigService.updateConfigValue(key, url, user.id);
    return { value: url };
  }

  // Clears a brand image override, reverting that slot to the compiled-in
  // default asset (stores an empty string rather than deleting the row).
  @Patch('branding/image/:slot/reset')
  async resetBrandImage(@Param('slot') slot: string, @CurrentUser() user: UserEntity) {
    const key = BRAND_IMAGE_SLOTS[slot];
    if (!key) throw new BadRequestException('Unknown brand image slot');
    await this.appConfigService.updateConfigValue(key, '', user.id);
    return { value: '' };
  }

  // Saves many keys in one request — used by /admin/settings' single Save
  // button, which previously fired one PATCH per field and could trip the
  // global write-rate-limit on a double-click or retry (see AppConfigService
  // .updateConfigValues for detail).
  @Patch('bulk')
  bulkUpdate(@Body() dto: BulkUpdateAppConfigDto, @CurrentUser() user: UserEntity) {
    return this.appConfigService.updateConfigValues(dto.entries, user.id);
  }

  @Patch(':key')
  update(
    @Param('key') key: string,
    @Body() dto: UpdateAppConfigDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.appConfigService.updateConfigValue(key, dto.value, user.id);
  }
}

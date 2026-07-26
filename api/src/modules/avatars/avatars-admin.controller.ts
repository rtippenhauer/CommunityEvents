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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import type { FileFilterCallback } from 'multer';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';
import { AvatarsService } from './avatars.service';
import { UpdateAvatarLabelDto } from './dto/update-avatar.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities/user.entity';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

const avatarStorage = diskStorage({
  destination: (_req, _file, cb) => {
    const dest = join(process.env.UPLOAD_PATH ?? '/app/uploads', 'avatars');
    mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${extname(file.originalname)}`);
  },
});

const imageFilter = (_req: any, file: Express.Multer.File, cb: FileFilterCallback): void => {
  const ext = extname(file.originalname).toLowerCase();
  if (ALLOWED_MIME.includes(file.mimetype) && ALLOWED_EXT.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'));
  }
};

@Controller('admin/avatars')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AvatarsAdminController {
  constructor(private readonly avatarsService: AvatarsService) {}

  @Get()
  list() {
    return this.avatarsService.getManifest();
  }

  // Uploads a preset avatar image, stores it under /api/uploads/avatars/, and
  // records it in the avatar table. The unique filename doubles as cache-busting.
  @Post()
  @UseInterceptors(
    FileInterceptor('image', {
      storage: avatarStorage,
      fileFilter: imageFilter,
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('label') label?: string,
  ) {
    if (!file) throw new BadRequestException('No image uploaded');
    const cleanLabel = (label ?? '').trim() || 'Avatar';
    const path = `/api/uploads/avatars/${file.filename}`;
    return this.avatarsService.create(path, cleanLabel);
  }

  @Patch(':id')
  updateLabel(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAvatarLabelDto) {
    return this.avatarsService.updateLabel(id, dto.label);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.avatarsService.remove(id);
    return { deleted: true };
  }
}

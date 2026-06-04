import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import type { Request } from 'express';
import type { FileFilterCallback } from 'multer';
import { extname } from 'path';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity } from '../../database/entities/user.entity';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp'];

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getProfile(@CurrentUser() user: UserEntity) {
    return this.usersService.findById(user.id);
  }

  @Patch('me')
  updateProfile(@CurrentUser() user: UserEntity, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user, dto);
  }

  @Post('me/photo')
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: diskStorage({
        destination: process.env.UPLOAD_PATH ?? './uploads/photos',
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `${unique}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
        const ext = extname(file.originalname).toLowerCase();
        if (ALLOWED_MIME.includes(file.mimetype) && ALLOWED_EXT.includes(ext)) {
          cb(null, true);
        } else {
          cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
        }
      },
    }),
  )
  async uploadPhoto(
    @CurrentUser() user: UserEntity,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ path: string }> {
    await this.usersService.updatePhotoPath(user.id, file.path);
    return { path: file.path };
  }
}

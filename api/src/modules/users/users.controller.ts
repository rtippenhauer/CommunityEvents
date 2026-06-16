import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import type { Request } from 'express';
import type { FileFilterCallback } from 'multer';
import { extname } from 'path';
import { mkdirSync } from 'fs';
import { Response } from 'express';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SetAvatarDto } from './dto/set-avatar.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity, EmailStatus, UserRole } from '../../database/entities/user.entity';
import { EmailService } from '../email/email.service';
import { SuppressionReason } from '../../database/entities/email-suppression.entity';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp'];

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly emailService: EmailService,
  ) {}

  @Get('me')
  getProfile(@CurrentUser() user: UserEntity) {
    return this.usersService.findById(user.id);
  }

  @Delete('me')
  @HttpCode(204)
  async deleteSelf(
    @CurrentUser() user: UserEntity,
    @Body() body: { confirm?: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (body?.confirm !== 'DELETE') {
      throw new BadRequestException('confirm must be "DELETE"');
    }
    await this.usersService.softDeleteSelf(user);
    res.clearCookie('access_token', { path: '/' });
  }

  @Get('members')
  getMembers(@CurrentUser() user: UserEntity) {
    return this.usersService.findMembers(user.role);
  }

  @Get(':id')
  getMemberProfile(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() viewer: UserEntity,
  ) {
    return this.usersService.findMemberProfile(id, viewer.id, viewer.role);
  }

  @Patch('me')
  updateProfile(@CurrentUser() user: UserEntity, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user, dto);
  }

  @Post('me/photo')
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dest = process.env.UPLOAD_PATH ?? '/app/uploads';
          mkdirSync(dest, { recursive: true });
          cb(null, dest);
        },
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
  ): Promise<{ url: string }> {
    const url = `/api/uploads/${file.filename}`;
    await this.usersService.updatePhotoPath(user.id, url);
    return { url };
  }

  @Post('me/avatar')
  selectAvatar(
    @CurrentUser() user: UserEntity,
    @Body() dto: SetAvatarDto,
  ): Promise<{ url: string }> {
    return this.usersService.setAvatar(user.id, dto.avatarPath);
  }

  @Get('me/notification-prefs')
  getNotificationPrefs(@CurrentUser() user: UserEntity) {
    return this.emailService.getNotificationPrefs(user.id);
  }

  @Patch('me/notification-prefs')
  updateNotificationPrefs(@CurrentUser() user: UserEntity, @Body() body: Record<string, boolean>) {
    return this.emailService.updateNotificationPrefs(user.id, body);
  }

  @Post('me/unsubscribe')
  async unsubscribe(@CurrentUser() user: UserEntity): Promise<{ message: string }> {
    await this.usersService.updateEmailStatus(user.id, EmailStatus.UNSUBSCRIBED);
    await this.emailService.suppress(user.email, SuppressionReason.UNSUBSCRIBED);
    return { message: 'You have been unsubscribed from DinnerBears emails.' };
  }

  @Post('me/resubscribe')
  async resubscribe(@CurrentUser() user: UserEntity): Promise<{ message: string }> {
    if (user.emailStatus === EmailStatus.COMPLAINED) {
      return { message: 'Spam complaints cannot be self-reversed. Please contact us.' };
    }
    await this.usersService.updateEmailStatus(user.id, EmailStatus.ACTIVE);
    await this.emailService.removeSuppression(user.email);
    return { message: 'You have been resubscribed to DinnerBears emails.' };
  }

  @Patch(':id/validate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  validateMember(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.validateMember(id);
  }
}

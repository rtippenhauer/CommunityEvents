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
  Query,
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
import { extname, join } from 'path';
import { mkdirSync } from 'fs';
import { Response } from 'express';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SetAvatarDto } from './dto/set-avatar.dto';
import { UpdateNotificationPrefsDto } from './dto/update-notification-prefs.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { EmailService } from '../email/email.service';
import { EmailStatus, SuppressionReason, UserRole } from '../../database/enums';
import type { users as User } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import {
  ACCESS_TOKEN_COOKIE,
  staleAccessTokenCookieVariants,
} from '../../common/utils/auth-cookie.util';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp'];

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  private readonly legacyCookieDomain: string;

  constructor(
    private readonly usersService: UsersService,
    private readonly emailService: EmailService,
    configService: ConfigService,
  ) {
    // Only ever used to clear the pre-v2-6 domain-scoped cookie; nothing sets
    // one any more. Same default as AuthController's, so the two cannot name
    // different domains and leave a cookie behind.
    const appUrl = configService.get<string>('APP_URL', 'http://localhost:8081');
    this.legacyCookieDomain = configService.get<string>(
      'BASE_DOMAIN',
      new URL(appUrl).hostname.replace(/^www\./, ''),
    );
  }

  @Get('me')
  getProfile(@CurrentUser() user: User) {
    return this.usersService.findById(user.id);
  }

  @Delete('me')
  @HttpCode(204)
  async deleteSelf(
    @CurrentUser() user: User,
    @Body() body: { confirm?: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (body?.confirm !== 'DELETE') {
      throw new BadRequestException('confirm must be "DELETE"');
    }
    await this.usersService.softDeleteSelf(user);
    // Every variant, not just the host-only one. This cleared `{ path: '/' }`
    // alone while login was still setting a domain-scoped cookie, which meant
    // deleting your own account left the session cookie in the browser -- it
    // only stopped working because the account was gone, not because the cookie
    // was removed.
    for (const options of staleAccessTokenCookieVariants(this.legacyCookieDomain)) {
      res.clearCookie(ACCESS_TOKEN_COOKIE, options);
    }
  }

  @Get('members')
  @RequireFeature('feature_members')
  getMembers(@CurrentUser() user: User, @Query('sort') sort?: string) {
    const sortParam = sort === 'alpha' ? 'alpha' : 'newest';
    return this.usersService.findMembers(user.role, sortParam);
  }

  @Get(':id')
  getMemberProfile(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() viewer: User,
  ) {
    return this.usersService.findMemberProfile(id, viewer.id, viewer.role);
  }

  @Patch('me')
  updateProfile(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user, dto);
  }

  @Post('me/photo')
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dest = join(process.env.UPLOAD_PATH ?? '/app/uploads', 'profiles');
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
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ url: string }> {
    const url = `/api/v1/uploads/profiles/${file.filename}`;
    await this.usersService.updatePhotoPath(user.id, url);
    return { url };
  }

  @Post('me/avatar')
  selectAvatar(
    @CurrentUser() user: User,
    @Body() dto: SetAvatarDto,
  ): Promise<{ url: string }> {
    return this.usersService.setAvatar(user.id, dto.avatarPath);
  }

  @Get('me/notification-prefs')
  getNotificationPrefs(@CurrentUser() user: User) {
    return this.emailService.getNotificationPrefs(user.id);
  }

  @Patch('me/notification-prefs')
  updateNotificationPrefs(@CurrentUser() user: User, @Body() dto: UpdateNotificationPrefsDto) {
    return this.emailService.updateNotificationPrefs(user.id, dto);
  }

  @Post('me/unsubscribe')
  async unsubscribe(@CurrentUser() user: User): Promise<{ message: string }> {
    await this.usersService.updateEmailStatus(user.id, EmailStatus.UNSUBSCRIBED);
    await this.emailService.suppress(user.email, SuppressionReason.UNSUBSCRIBED);
    return { message: 'You have been unsubscribed from DinnerBears emails.' };
  }

  @Post('me/resubscribe')
  async resubscribe(@CurrentUser() user: User): Promise<{ message: string }> {
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

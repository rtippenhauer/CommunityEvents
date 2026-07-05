import { Controller, Get, NotFoundException, Param, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'fs';
import { basename, join } from 'path';
import type { Response } from 'express';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity } from '../../database/entities/user.entity';

// Unlike restaurant photos, achievement icons, and custom icons (all served as
// static assets — see main.ts), uploaded profile photos are streamed through
// this route so they're only viewable by signed-in members, not the open web.
@Controller('uploads/profiles')
export class ProfilePhotosController {
  constructor(private readonly config: ConfigService) {}

  @Get(':filename')
  @UseGuards(OptionalJwtAuthGuard)
  getPhoto(
    @Param('filename') filename: string,
    @CurrentUser() user: UserEntity | null,
    @Res() res: Response,
  ): void {
    if (!user) throw new UnauthorizedException();

    const uploadPath = this.config.get<string>('UPLOAD_PATH', '/app/uploads');
    const filePath = join(uploadPath, 'profiles', basename(filename));
    if (!existsSync(filePath)) throw new NotFoundException();

    res.sendFile(filePath);
  }
}

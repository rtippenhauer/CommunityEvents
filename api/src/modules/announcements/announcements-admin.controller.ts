import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateFlagDto } from './dto/update-flag.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/enums';
import type { users as User } from '@prisma/client';

@Controller('admin/announcements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class AnnouncementsAdminController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Get()
  findAll() {
    return this.announcementsService.findAllAdmin();
  }

  @Get('flags')
  getFlags() {
    return this.announcementsService.getAllFlags();
  }

  @Get('flags/pending-count')
  async pendingFlagCount() {
    const count = await this.announcementsService.countPendingFlags();
    return { count };
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.announcementsService.findOneAdmin(id);
  }

  @Post()
  create(@Body() dto: CreateAnnouncementDto, @CurrentUser() user: User) {
    return this.announcementsService.create(dto, user.id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateAnnouncementDto) {
    return this.announcementsService.update(id, dto);
  }

  @Post(':id/publish')
  publish(@Param('id', ParseIntPipe) id: number) {
    return this.announcementsService.publish(id);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.announcementsService.delete(id);
  }

  @Patch('flags/:flagId')
  resolveFlag(
    @Param('flagId', ParseIntPipe) flagId: number,
    @Body() dto: UpdateFlagDto,
    @CurrentUser() user: User,
  ) {
    return this.announcementsService.resolveFlag(flagId, user.id, dto.status);
  }
}

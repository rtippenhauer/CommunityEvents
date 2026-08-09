import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ReleasesService } from './releases.service';
import { CreateReleaseDto } from './dto/create-release.dto';
import { UpdateReleaseDto } from './dto/update-release.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/enums';
import type { users as User } from '@prisma/client';

@Controller('admin/releases')
export class ReleasesAdminController {
  constructor(private readonly releasesService: ReleasesService) {}

  // Read-only listing is automation-accessible so Claude can check what's
  // published/drafted without needing Rob to elevate its role first — the
  // role-picker elevation is reserved for browsing role-gated pages that
  // aren't otherwise automation-scoped.
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.AUTOMATION)
  findAll() {
    return this.releasesService.findAll();
  }

  @Get('resolved-feedback')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  getResolvedFeedback() {
    return this.releasesService.getResolvedFeedback();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.releasesService.findOneAdmin(id);
  }

  // Draft creation and unpublish are automation-enabled, via the dedicated
  // automation account's own login (see AuthService.automationLogin).
  // Editing and publishing stay human/browser-session-only — per CLAUDE.md,
  // publishing is always a manual, separate action, never done by Claude.
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.AUTOMATION)
  create(@Body() dto: CreateReleaseDto, @CurrentUser() user: User) {
    return this.releasesService.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateReleaseDto) {
    return this.releasesService.update(id, dto);
  }

  @Post(':id/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  publish(@Param('id', ParseIntPipe) id: number) {
    return this.releasesService.publish(id);
  }

  @Post(':id/unpublish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.AUTOMATION)
  unpublish(@Param('id', ParseIntPipe) id: number) {
    return this.releasesService.unpublish(id);
  }
}

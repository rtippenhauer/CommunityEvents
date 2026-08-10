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
import { FeedbackService } from './feedback.service';
import { UpdateFeedbackDto } from './dto/update-feedback.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/enums';
import type { users as User } from '@prisma/client';

@Controller('admin/feedback')
export class FeedbackAdminController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  findAll() {
    return this.feedbackService.findAll();
  }

  // Automation-enabled: the Bug-Driven Development Workflow (CLAUDE.md) reads
  // open bugs and in-progress items, updates status, and adds admin notes,
  // via the dedicated automation account's own login.
  @Get('open-bugs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR, UserRole.AUTOMATION)
  getOpenBugs() {
    return this.feedbackService.getOpenBugs();
  }

  @Get('in-progress')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR, UserRole.AUTOMATION)
  getInProgress() {
    return this.feedbackService.getInProgress();
  }

  @Get('unseen-count')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  async getUnseenCount(): Promise<{ count: number }> {
    const count = await this.feedbackService.getUnseenCount();
    return { count };
  }

  @Patch('mark-all-seen')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  async markAllSeen(): Promise<{ count: number }> {
    await this.feedbackService.markAllSeen();
    return { count: 0 };
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR, UserRole.AUTOMATION)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateFeedbackDto) {
    return this.feedbackService.update(id, dto);
  }

  @Patch(':id/seen')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  markSeen(@Param('id', ParseIntPipe) id: number) {
    return this.feedbackService.markSeen(id);
  }

  @Post(':id/notes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR, UserRole.AUTOMATION)
  addAdminNote(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateNoteDto,
    @CurrentUser() user: User,
  ) {
    return this.feedbackService.addNote(id, user.id, dto, true);
  }
}

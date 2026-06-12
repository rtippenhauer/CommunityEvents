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
import { UserEntity, UserRole } from '../../database/entities/user.entity';

@Controller('admin/feedback')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class FeedbackAdminController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Get()
  findAll() {
    return this.feedbackService.findAll();
  }

  @Get('open-bugs')
  getOpenBugs() {
    return this.feedbackService.getOpenBugs();
  }

  @Get('unseen-count')
  async getUnseenCount(): Promise<{ count: number }> {
    const count = await this.feedbackService.getUnseenCount();
    return { count };
  }

  @Patch('mark-all-seen')
  async markAllSeen(): Promise<{ count: number }> {
    await this.feedbackService.markAllSeen();
    return { count: 0 };
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateFeedbackDto) {
    return this.feedbackService.update(id, dto);
  }

  @Patch(':id/seen')
  markSeen(@Param('id', ParseIntPipe) id: number) {
    return this.feedbackService.markSeen(id);
  }

  @Post(':id/notes')
  addAdminNote(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateNoteDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.feedbackService.addNote(id, user.id, dto, true);
  }
}

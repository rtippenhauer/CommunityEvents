import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity, UserRole } from '../../database/entities/user.entity';
import { FeedbackCategory } from '../../database/entities/feedback.entity';

@Controller('feedback')
@UseGuards(JwtAuthGuard)
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  create(@Body() dto: CreateFeedbackDto, @CurrentUser() user: UserEntity) {
    if (user.role === UserRole.NON_VALIDATED) {
      throw new ForbiddenException('Non-validated members cannot submit feedback');
    }
    return this.feedbackService.create(dto, user.id);
  }

  @Get()
  findAll(
    @CurrentUser() user: UserEntity,
    @Query('category') category?: FeedbackCategory,
    @Query('sort') sort?: 'newest' | 'upvotes',
  ) {
    return this.feedbackService.findPublic(user.id, category, sort ?? 'newest');
  }

  @Get('mine')
  findMine(@CurrentUser() user: UserEntity) {
    return this.feedbackService.findMine(user.id);
  }

  @Get('my-stats')
  getMyStats(@CurrentUser() user: UserEntity) {
    return this.feedbackService.getMemberStats(user.id);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserEntity) {
    const isAdmin = user.role === UserRole.ADMIN || user.role === UserRole.MODERATOR;
    return this.feedbackService.findOne(id, user.id, isAdmin);
  }

  @Post(':id/upvote')
  toggleUpvote(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserEntity) {
    return this.feedbackService.toggleUpvote(id, user.id);
  }

  @Get(':id/notes')
  getNotes(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserEntity) {
    const isAdmin = user.role === UserRole.ADMIN || user.role === UserRole.MODERATOR;
    return this.feedbackService.getNotes(id, isAdmin);
  }

  @Post(':id/notes')
  addNote(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateNoteDto,
    @CurrentUser() user: UserEntity,
  ) {
    if (user.role === UserRole.NON_VALIDATED) {
      throw new ForbiddenException('Non-validated members cannot add notes');
    }
    const isAdmin = user.role === UserRole.ADMIN || user.role === UserRole.MODERATOR;
    return this.feedbackService.addNote(id, user.id, dto, isAdmin);
  }
}

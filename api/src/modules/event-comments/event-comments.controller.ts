import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { EventCommentsService } from './event-comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/enums';
import type { users as User } from '@prisma/client';

@Controller('events/:eventId/comments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EventCommentsController {
  constructor(private readonly commentsService: EventCommentsService) {}

  @Get()
  @Roles(UserRole.MEMBER, UserRole.MODERATOR, UserRole.ADMIN)
  getComments(@Param('eventId', ParseIntPipe) eventId: number) {
    return this.commentsService.getComments(eventId);
  }

  @Post()
  @Roles(UserRole.MEMBER, UserRole.MODERATOR, UserRole.ADMIN)
  addComment(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: User,
  ) {
    return this.commentsService.addComment(eventId, user, dto);
  }

  @Patch(':commentId')
  @Roles(UserRole.MEMBER, UserRole.MODERATOR, UserRole.ADMIN)
  editComment(
    @Param('commentId', ParseIntPipe) commentId: number,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: User,
  ) {
    return this.commentsService.editComment(commentId, user, dto);
  }

  @Delete(':commentId')
  @Roles(UserRole.MEMBER, UserRole.MODERATOR, UserRole.ADMIN)
  deleteComment(
    @Param('commentId', ParseIntPipe) commentId: number,
    @CurrentUser() user: User,
  ) {
    return this.commentsService.deleteComment(commentId, user);
  }

  @Post(':commentId/replies')
  @Roles(UserRole.MEMBER, UserRole.MODERATOR, UserRole.ADMIN)
  addReply(
    @Param('commentId', ParseIntPipe) commentId: number,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: User,
  ) {
    return this.commentsService.addReply(commentId, user, dto);
  }

  @Patch(':commentId/replies/:replyId')
  @Roles(UserRole.MEMBER, UserRole.MODERATOR, UserRole.ADMIN)
  editReply(
    @Param('replyId', ParseIntPipe) replyId: number,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: User,
  ) {
    return this.commentsService.editReply(replyId, user, dto);
  }

  @Delete(':commentId/replies/:replyId')
  @Roles(UserRole.MEMBER, UserRole.MODERATOR, UserRole.ADMIN)
  deleteReply(
    @Param('replyId', ParseIntPipe) replyId: number,
    @CurrentUser() user: User,
  ) {
    return this.commentsService.deleteReply(replyId, user);
  }
}

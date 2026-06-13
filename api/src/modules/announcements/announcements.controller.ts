import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { FlagContentDto } from './dto/flag-content.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity, UserStatus } from '../../database/entities/user.entity';

@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Get()
  findAll(@Query('cityId') cityId?: string) {
    return this.announcementsService.findPublished(cityId ? Number(cityId) : undefined);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.announcementsService.findOne(id);
  }

  @Post(':id/comments')
  @UseGuards(JwtAuthGuard)
  addComment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: UserEntity,
  ) {
    if (user.status === UserStatus.NON_VALIDATED) {
      throw new ForbiddenException('Non-validated members cannot post comments');
    }
    return this.announcementsService.addComment(id, user.id, dto);
  }

  @Delete('comments/:commentId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  deleteComment(
    @Param('commentId', ParseIntPipe) commentId: number,
    @CurrentUser() user: UserEntity,
  ) {
    return this.announcementsService.deleteComment(commentId, user.id, user.role);
  }

  @Post('flag')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  flagContent(@Body() dto: FlagContentDto, @CurrentUser() user: UserEntity) {
    return this.announcementsService.flagContent(dto, user.id);
  }
}

import { Controller, Get, Param, ParseIntPipe, Patch, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity } from '../../database/entities/user.entity';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findAll(@CurrentUser() user: UserEntity) {
    return this.notificationsService.findForUser(user.id);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: UserEntity) {
    return this.notificationsService.countUnread(user.id).then((count) => ({ count }));
  }

  @Patch(':id/read')
  markRead(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserEntity) {
    return this.notificationsService.markRead(id, user.id);
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() user: UserEntity) {
    return this.notificationsService.markAllRead(user.id);
  }
}

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
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { SubscribePushDto } from './dto/subscribe-push.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { users as User } from '@prisma/client';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly pushService: PushService,
  ) {}

  @Get()
  findAll(@CurrentUser() user: User) {
    return this.notificationsService.findForUser(user.id);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: User) {
    return this.notificationsService.countUnread(user.id).then((count) => ({ count }));
  }

  @Patch(':id/read')
  markRead(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: User) {
    return this.notificationsService.markRead(id, user.id);
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() user: User) {
    return this.notificationsService.markAllRead(user.id);
  }

  @Post('push/subscribe')
  @HttpCode(204)
  async subscribe(@Body() dto: SubscribePushDto, @CurrentUser() user: User) {
    await this.pushService.subscribe(user.id, dto.endpoint, dto.keys.p256dh, dto.keys.auth);
  }

  @Delete('push/subscribe')
  @HttpCode(204)
  async unsubscribe(@Body() dto: Pick<SubscribePushDto, 'endpoint'>, @CurrentUser() user: User) {
    await this.pushService.unsubscribe(user.id, dto.endpoint);
  }
}

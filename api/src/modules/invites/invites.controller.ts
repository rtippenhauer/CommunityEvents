import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { InvitesService } from './invites.service';
import { CreateInviteDto } from './dto/create-invite.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity, UserRole } from '../../database/entities/user.entity';
import { InviteType } from '../../database/entities/invite.entity';

@Controller('invites')
export class InvitesController {
  constructor(private readonly invitesService: InvitesService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() dto: CreateInviteDto, @CurrentUser() user: UserEntity) {
    if (user.role === UserRole.NON_VALIDATED) {
      throw new ForbiddenException('Non-validated members cannot send invites');
    }
    const isElevated = user.role === UserRole.ADMIN || user.role === UserRole.MODERATOR;
    const effectiveDto: CreateInviteDto = isElevated ? dto : { ...dto, type: InviteType.MEMBER as InviteType.MEMBER };
    return this.invitesService.create(effectiveDto, user);
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  findMine(@CurrentUser() user: UserEntity) {
    return this.invitesService.findByCreator(user.id);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  findAll() {
    return this.invitesService.findAll();
  }

  @Patch(':id/revoke')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  revoke(@Param('id', ParseIntPipe) id: number) {
    return this.invitesService.revoke(id);
  }

  @Patch(':id/revoke-own')
  @UseGuards(JwtAuthGuard)
  revokeOwn(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserEntity) {
    return this.invitesService.revokeOwn(id, user.id);
  }

  // Public — no auth — used by /join/:code page to preview event invite details
  @Get('preview/:token')
  async preview(@Param('token') token: string) {
    const invite = await this.invitesService.findByToken(token);
    if (!invite || invite.type !== InviteType.EVENT_INVITE) {
      throw new NotFoundException('Invite not found');
    }
    const event = invite.event;
    const photo = event?.location?.photos?.[0]?.filePath ?? null;
    return {
      token: invite.token,
      flavor: invite.inviteFlavor,
      isRevoked: invite.isRevoked,
      isExpired: invite.expiresAt < new Date(),
      isFull: invite.maxUses !== null && invite.useCount >= invite.maxUses,
      expiresAt: invite.expiresAt,
      event: event
        ? {
            id: event.id,
            title: event.title,
            eventDate: event.eventDate,
            eventTime: event.eventTime,
            status: event.status,
            locationName: event.locationName,
            locationAddress: event.locationAddress,
            locationPhotoUrl: photo,
          }
        : null,
    };
  }
}

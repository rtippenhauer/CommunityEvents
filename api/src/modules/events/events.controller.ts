import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { EventsService } from './events.service';
import { InvitesService } from '../invites/invites.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { UpsertRsvpDto } from './dto/upsert-rsvp.dto';
import { CreateGuestLinkDto } from './dto/create-guest-link.dto';
import { CreatePublicRsvpDto } from './dto/create-public-rsvp.dto';
import { UseGuestLinkDto } from './dto/use-guest-link.dto';
import { CreateEventInviteDto } from './dto/create-event-invite.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity, UserRole, UserStatus } from '../../database/entities/user.entity';
import { EventStatus } from '../../database/entities/event.entity';

@Controller('events')
export class EventsController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly invitesService: InvitesService,
  ) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @Header('Cache-Control', 'no-store')
  findAll(
    @Query('cityId') cityId?: string,
    @Query('upcoming') upcoming?: string,
    @Query('fromDate') fromDate?: string,
    @Query('status') status?: EventStatus,
    @CurrentUser() user?: UserEntity,
  ) {
    const isAdminOrMod =
      user?.role === UserRole.ADMIN || user?.role === UserRole.MODERATOR;

    return this.eventsService.findAll({
      cityId: cityId ? parseInt(cityId, 10) : undefined,
      fromDate: fromDate || undefined,
      upcoming: fromDate ? undefined : (upcoming === 'true' ? true : upcoming === 'false' ? false : undefined),
      status: isAdminOrMod ? status : undefined,
      isAdminOrMod,
      userId: user?.id,
    });
  }

  @Get(':id/ics')
  async downloadIcs(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    const ics = await this.eventsService.generateIcs(id);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="dinnerbears-event-${id}.ics"`);
    res.end(ics);
  }

  @Get('guest-ics/:token')
  async downloadGuestIcs(
    @Param('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    const { ics, eventId } = await this.eventsService.generateGuestIcs(token);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="dinnerbears-event-${eventId}.ics"`);
    res.end(ics);
  }

  @Get('guest-link/:token')
  getGuestLink(@Param('token') token: string) {
    return this.eventsService.getGuestLink(token);
  }

  @Post('guest-link/:token')
  useGuestLink(@Param('token') token: string, @Body() dto: UseGuestLinkDto) {
    return this.eventsService.useGuestLink(token, dto.guestName);
  }

  @Delete('guest-link/:token')
  cancelGuestRsvp(@Param('token') token: string) {
    return this.eventsService.cancelGuestRsvp(token);
  }

  @Delete(':id/rsvp/link/:linkId')
  @UseGuards(JwtAuthGuard)
  removeGuestLink(
    @Param('id', ParseIntPipe) _id: number,
    @Param('linkId', ParseIntPipe) linkId: number,
    @CurrentUser() user: UserEntity,
  ) {
    return this.eventsService.removeGuestLink(linkId, user.id);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @Header('Cache-Control', 'no-store')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.eventsService.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  create(@Body() dto: CreateEventDto, @CurrentUser() user: UserEntity) {
    return this.eventsService.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEventDto) {
    return this.eventsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.eventsService.remove(id);
  }

  @Post(':id/public-rsvp')
  async publicRsvp(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreatePublicRsvpDto,
  ) {
    await this.eventsService.createPublicRsvp(id, dto.name, dto.email);
    return { success: true };
  }

  @Post(':id/rsvp')
  @UseGuards(JwtAuthGuard)
  rsvp(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertRsvpDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.eventsService.upsertRsvp(id, user.id, dto.status, dto.additionalGuests, dto.guestNames, user.role);
  }

  @Delete(':id/rsvp')
  @UseGuards(JwtAuthGuard)
  unrsvp(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserEntity) {
    return this.eventsService.removeRsvp(id, user.id);
  }

  @Post(':id/rsvp/link')
  @UseGuards(JwtAuthGuard)
  generateGuestLink(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateGuestLinkDto,
    @CurrentUser() user: UserEntity,
  ) {
    if (user.status === UserStatus.NON_VALIDATED) {
      throw new ForbiddenException('Non-validated members cannot invite guests');
    }
    return this.eventsService.generateGuestLink(id, user.id, dto.recipientName, dto.recipientEmail);
  }

  // Event invite links (admin only — for /join/:code flow)
  @Get(':id/invite-links')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  getEventInviteLinks(@Param('id', ParseIntPipe) id: number) {
    return this.invitesService.findByEvent(id);
  }

  @Post(':id/invite-links')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  createEventInviteLink(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateEventInviteDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.invitesService.createEventInvite(id, dto.flavor, user, dto.maxUses, dto.expiryDays);
  }

  @Patch(':id/invite-links/:inviteId/revoke')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  revokeEventInviteLink(
    @Param('inviteId', ParseIntPipe) inviteId: number,
  ) {
    return this.invitesService.revoke(inviteId);
  }
}

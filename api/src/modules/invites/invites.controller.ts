import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { InvitesService } from './invites.service';
import { CreateInviteDto } from './dto/create-invite.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity, UserRole } from '../../database/entities/user.entity';

@Controller('invites')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvitesController {
  constructor(private readonly invitesService: InvitesService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  create(@Body() dto: CreateInviteDto, @CurrentUser() user: UserEntity) {
    return this.invitesService.create(dto, user);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  findAll() {
    return this.invitesService.findAll();
  }

  @Patch(':id/revoke')
  @Roles(UserRole.ADMIN)
  revoke(@Param('id', ParseIntPipe) id: number) {
    return this.invitesService.revoke(id);
  }
}

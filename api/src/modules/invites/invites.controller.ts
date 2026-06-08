import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { InvitesService } from './invites.service';
import { CreateInviteDto } from './dto/create-invite.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity, UserRole } from '../../database/entities/user.entity';
import { InviteType } from '../../database/entities/invite.entity';

@Controller('invites')
@UseGuards(JwtAuthGuard)
export class InvitesController {
  constructor(private readonly invitesService: InvitesService) {}

  @Post()
  create(@Body() dto: CreateInviteDto, @CurrentUser() user: UserEntity) {
    const isElevated = user.role === UserRole.ADMIN || user.role === UserRole.MODERATOR;
    const effectiveDto = isElevated ? dto : { ...dto, type: InviteType.MEMBER };
    return this.invitesService.create(effectiveDto, user);
  }

  @Get('mine')
  findMine(@CurrentUser() user: UserEntity) {
    return this.invitesService.findByCreator(user.id);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  findAll() {
    return this.invitesService.findAll();
  }

  @Patch(':id/revoke')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  revoke(@Param('id', ParseIntPipe) id: number) {
    return this.invitesService.revoke(id);
  }
}

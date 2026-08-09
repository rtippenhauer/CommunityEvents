import { Controller, Get, UseGuards } from '@nestjs/common';
import { FacebookGroupsService } from './facebook-groups.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/enums';

@Controller('facebook-groups')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class FacebookGroupsController {
  constructor(private readonly facebookGroupsService: FacebookGroupsService) {}

  @Get()
  findAll() {
    return this.facebookGroupsService.findAll();
  }
}

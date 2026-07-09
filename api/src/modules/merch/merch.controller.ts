import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { MerchService } from './merch.service';
import { UpdateMerchConfigDto } from './dto/update-merch-config.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity, UserRole } from '../../database/entities/user.entity';

@Controller('merch')
@UseGuards(JwtAuthGuard)
export class MerchController {
  constructor(private readonly merchService: MerchService) {}

  @Get()
  getLinks(@CurrentUser() user: UserEntity) {
    return this.merchService.getLinksForUser(user.id);
  }

  @Get('admin/config')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  getConfig() {
    return this.merchService.getConfig();
  }

  @Patch('admin/config')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  updateConfig(@Body() dto: UpdateMerchConfigDto) {
    return this.merchService.updateConfig(dto);
  }
}

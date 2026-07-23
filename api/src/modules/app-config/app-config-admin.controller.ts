import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { AppConfigService } from './app-config.service';
import { UpdateAppConfigDto } from './dto/update-app-config.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity, UserRole } from '../../database/entities/user.entity';

@Controller('admin/config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AppConfigAdminController {
  constructor(private readonly appConfigService: AppConfigService) {}

  @Get('legal')
  getLegalConfig() {
    return this.appConfigService.getLegalConfig();
  }

  @Patch(':key')
  update(
    @Param('key') key: string,
    @Body() dto: UpdateAppConfigDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.appConfigService.updateLegalConfig(key, dto.value, user.id);
  }
}

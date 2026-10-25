import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CitiesService } from './cities.service';
import { CreateCityDto } from './dto/create-city.dto';
import { RetireCityDto, UpdateCityDto } from './dto/update-city.dto';
import { SetCitiesFeatureDto } from './dto/set-cities-feature.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/enums';
import type { users as User } from '@prisma/client';

/**
 * A community's own cities.
 *
 * `@Roles(ADMIN)` is correct here **as of v2-24** and was a cross-tenant write
 * hole before it: `cities` was global, so this guard said "an admin of
 * anywhere" over a table belonging to everyone. Rob found it on stage during
 * the v2-12 pass and it was left open deliberately, because fixing it properly
 * meant scoping the model, which is this item. Nothing below filters by tenant
 * by hand — the scoping extension does it — which is the point: the guard now
 * only has to answer "is this an admin", and "of which community" is no longer
 * a question this file can get wrong.
 */
@Controller('admin/cities')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class CitiesAdminController {
  constructor(private readonly citiesService: CitiesService) {}

  @Get()
  async findAll() {
    const [cities, enabled] = await Promise.all([
      this.citiesService.findAllAdmin(),
      this.citiesService.isEnabled(),
    ]);
    return { cities, enabled };
  }

  @Post()
  create(@Body() dto: CreateCityDto) {
    return this.citiesService.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCityDto) {
    return this.citiesService.update(id, dto);
  }

  @Post(':id/reactivate')
  reactivate(@Param('id', ParseIntPipe) id: number) {
    return this.citiesService.reactivate(id);
  }

  /**
   * What retiring this city would move, before anybody commits to it.
   *
   * A separate GET rather than a dry-run flag on the retire call, so the dialog
   * can show the counts while the admin is still choosing a destination.
   */
  @Get(':id/retirement-impact')
  retirementImpact(@Param('id', ParseIntPipe) id: number) {
    return this.citiesService.retirementImpact(id);
  }

  @Post(':id/retire')
  retire(@Param('id', ParseIntPipe) id: number, @Body() dto: RetireCityDto) {
    return this.citiesService.retire(id, dto.moveToCityId);
  }

  /**
   * The feature toggle, which lives here rather than on Admin → Site Settings
   * with the other switches, because it is the only one that rewrites data.
   */
  @Put('feature')
  setFeature(@Body() dto: SetCitiesFeatureDto, @CurrentUser() user: User) {
    return this.citiesService.setEnabled(dto.enabled, user.id);
  }
}

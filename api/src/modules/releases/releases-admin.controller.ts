import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ReleasesService } from './releases.service';
import { CreateReleaseDto } from './dto/create-release.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity, UserRole } from '../../database/entities/user.entity';

@Controller('admin/releases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ReleasesAdminController {
  constructor(private readonly releasesService: ReleasesService) {}

  @Get()
  findAll() {
    return this.releasesService.findAll();
  }

  @Get('resolved-feedback')
  getResolvedFeedback() {
    return this.releasesService.getResolvedFeedback();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.releasesService.findOneAdmin(id);
  }

  @Post()
  create(@Body() dto: CreateReleaseDto, @CurrentUser() user: UserEntity) {
    return this.releasesService.create(dto, user.id);
  }

  @Post(':id/publish')
  publish(@Param('id', ParseIntPipe) id: number) {
    return this.releasesService.publish(id);
  }
}

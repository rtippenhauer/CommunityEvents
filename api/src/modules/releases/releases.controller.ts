import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { ReleasesService } from './releases.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities/user.entity';

// Validated members and above only — non_validated and anonymous visitors
// don't see the changelog. Also closes the gap where an author's or credited
// feedback-submitter's uploaded profile photo would 401 for an anonymous
// visitor (uploaded photos require a login; preset avatars don't).
@Controller('releases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MEMBER, UserRole.MODERATOR, UserRole.ADMIN)
export class ReleasesController {
  constructor(private readonly releasesService: ReleasesService) {}

  @Get()
  findAll() {
    return this.releasesService.findPublishedList();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.releasesService.findOnePublished(id);
  }
}

import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ReleasesService } from './releases.service';

@Controller('releases')
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

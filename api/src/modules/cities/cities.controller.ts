import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { CitiesService } from './cities.service';

@Controller('cities')
export class CitiesController {
  constructor(private readonly citiesService: CitiesService) {}

  /**
   * The cities a picker may offer.
   *
   * `include` is the row's own current value, which is added even when it has
   * been retired. Editing a past event otherwise silently drops its city: the
   * `mat-select` finds no option matching `cityId`, renders blank, and the
   * form's `Validators.min(1)` then refuses a save that has nothing to do with
   * cities. Retired entries are marked by their `isActive: false`, which is
   * what lets the picker label them rather than present them as ordinary
   * choices.
   */
  @Get()
  findAll(@Query('include', new ParseIntPipe({ optional: true })) include?: number) {
    return this.citiesService.findAllForPicker(include);
  }
}

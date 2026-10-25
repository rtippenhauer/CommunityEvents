import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';

export class SetCitiesFeatureDto {
  /**
   * Read off the raw body rather than the transformed value.
   *
   * The global pipe runs with `enableImplicitConversion: true`, which coerces
   * a value to its declared type *before* `class-validator` sees it — so a
   * plain `@IsBoolean()` accepts any non-empty string as `true` (found in
   * v2-29). That matters here more than on most flags: `{"enabled":"no"}` would
   * validate as `true` and run the backfill, rewriting every null `city_id` in
   * the community. `@Transform` reading `obj` gets the value as it arrived, so
   * anything that is not a real boolean is a 400 rather than a guess.
   */
  @Transform(({ obj }) => (obj as { enabled?: unknown }).enabled)
  @IsBoolean()
  enabled: boolean;
}

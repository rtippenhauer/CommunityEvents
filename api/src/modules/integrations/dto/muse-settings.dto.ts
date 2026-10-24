import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';

/**
 * Whether Muse may publish a private venue to Facebook (v2-29).
 *
 * `forbidNonWhitelisted` is on globally, so this DTO is the whole accepted
 * body -- an extra key is a 400, not an ignored field.
 *
 * **The `@Transform` is load-bearing, not decoration.** The global pipe sets
 * `enableImplicitConversion: true`, which coerces the value to the declared
 * type *before* `@IsBoolean()` sees it -- so `"yes"`, `"false"` and `"0"` all
 * arrive as `true` and validate cleanly. Reading the raw value off `obj`
 * bypasses that conversion, so a non-boolean is rejected instead of being
 * guessed at. This flag decides whether a member's home address and photos of
 * their house are published to a public Facebook event, which is not something
 * to infer from a typo.
 */
export class UpdateMuseSettingsDto {
  @Transform(({ obj }) => (obj as { sharePrivateVenues?: unknown }).sharePrivateVenues)
  @IsBoolean()
  sharePrivateVenues!: boolean;
}

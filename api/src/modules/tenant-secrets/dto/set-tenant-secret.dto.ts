import { IsString, MaxLength, MinLength } from 'class-validator';

export class SetTenantSecretDto {
  /**
   * The credential itself, in plaintext. It is encrypted before it reaches the
   * database and is never read back out through the API — the listing reports
   * only whether a key is set and where it resolves from.
   *
   * The bounds are sanity checks, not format validation: these are third-party
   * keys whose shapes are not ours to predict, and rejecting a valid one
   * because it did not match a guessed pattern is the worse failure. Clearing
   * is DELETE, so the empty string is not a way to spell it.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  value!: string;
}

import { IsString, Length, Matches } from 'class-validator';

export class CreateIntegrationAccountDto {
  /**
   * The display name, which also derives the local part of the address
   * (`Muse` -> `muse@integration.invalid`).
   *
   * Constrained to letters, digits, spaces, hyphens and underscores rather than
   * left free: the name is slugified into an email address, and `v2-12` found
   * what unvalidated credential fields cost -- a password manager filled an
   * email address into a client id field and the screen then discarded the
   * API's explanation of why it failed.
   */
  @IsString()
  @Length(2, 80)
  @Matches(/^[A-Za-z0-9 _-]+$/, {
    message: 'Name may contain only letters, digits, spaces, hyphens and underscores.',
  })
  name!: string;
}

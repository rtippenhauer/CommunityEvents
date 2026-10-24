import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * Muse's extraction format, accepted as-is (v2-29).
 *
 * **snake_case on purpose.** Every other DTO in this codebase is camelCase, and
 * this one deliberately is not: the contract in `docs/MUSE_API.md` is v1's and
 * has to stay identical, because Muse is an outside app that is already sending
 * this shape to v1. Renaming the fields here would be a change nobody can see
 * from this repo and would break the integration on the cutover.
 *
 * **The informational fields must be accepted and ignored** -- `title`,
 * `facebook_event_url`, `note`. They are declared below as optional and then
 * never read, which is the only way to honour that: `main.ts` runs the global
 * `ValidationPipe` with **`forbidNonWhitelisted: true`**, so an undeclared
 * field is a 400, not a dropped one. Muse sends all three for human
 * readability, and rejecting them would stop a whole run over a comment.
 *
 * Found by the e2e spec, not by review -- the first version of this file
 * asserted in a comment that validation was lenient here, and it is not.
 */
export class FacebookGuestDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsString()
  @MaxLength(255)
  profile_url!: string;

  /**
   * The permanent key. Digits only -- a vanity URL here instead of the numeric
   * id would create a second row for a person every time they renamed
   * themselves, which is exactly what keying on the numeric id avoids.
   */
  @IsString()
  @Matches(/^\d{1,32}$/, { message: 'facebook_user_id must be digits' })
  facebook_user_id!: string;

  /** Names of the +1s from the comments. The same name may repeat (rule 9). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  plus_one_names?: string[];

  /** Total +1s. Sent alone for a "+2" comment with no names. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  plus_ones?: number;
}

export class FacebookSyncEventDto {
  @IsInt()
  @Min(1)
  dinnerbears_event_id!: number;

  @IsString()
  @Matches(/^\d{1,32}$/, { message: 'facebook_event_id must be digits' })
  facebook_event_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  facebook_group?: string;

  /**
   * Facebook's own Going count. When it disagrees with `guests.length` the list
   * is treated as partial and **nobody is removed** for this Facebook event
   * (rule 12) -- a truncated scrape must not empty a dinner.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  going_count?: number;

  /**
   * Everyone on the Going tab. `[]` means nobody is Going, which is a real
   * statement and not the same as omitting the field -- it is what removes
   * people.
   */
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => FacebookGuestDto)
  guests!: FacebookGuestDto[];

  /**
   * Informational, declared so it is accepted and then ignored. Never read:
   * the title of a dinner lives here, not on Facebook's copy of it.
   */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  /** Informational. The URL is derived from the id wherever one is shown. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  facebook_event_url?: string;
}

export class FacebookSyncDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => FacebookSyncEventDto)
  events!: FacebookSyncEventDto[];

  /**
   * When the lists were **read from Facebook**, not when they arrived here.
   * Rule 12's replay guard turns on that difference: a slow run whose
   * extraction predates one already applied is skipped, and a received-at
   * timestamp cannot tell the two apart.
   */
  @IsOptional()
  @IsISO8601()
  extracted_at?: string;

  /** Informational, e.g. "nightly run". Accepted and ignored. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

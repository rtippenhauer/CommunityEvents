import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Mirrors the `demo_would_use` enum; "maybe" is the honest middle. */
export enum DemoWouldUse {
  YES = 'yes',
  MAYBE = 'maybe',
  NO = 'no',
}

/**
 * The demo survey (Rob, 2026-10-04).
 *
 * **Every field is optional, and that is the design.** A survey that refuses to
 * submit until one more box is filled is a survey that gets abandoned, and a
 * partial answer from somebody who tried the product for a week is worth more
 * than a complete answer from nobody. "At least one of them" is checked in the
 * service, where the rule can see all the fields at once -- class-validator has
 * no decorator for "this field is required unless some other field is present"
 * that stays readable as questions are added.
 *
 * It replaced a single free-text box, which asked the visitor to work out for
 * themselves what was worth saying.
 */
export class CreateDemoFeedbackDto {
  /** Overall, 1-5. */
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(5)
  rating?: number;

  /** The question the survey exists to answer. */
  @IsEnum(DemoWouldUse)
  @IsOptional()
  wouldUse?: DemoWouldUse;

  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(5000)
  whatWorked?: string;

  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(5000)
  whatDidnt?: string;

  /** Anything the questions did not ask about. */
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(5000)
  body?: string;
}

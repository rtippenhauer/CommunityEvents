import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * What a demo visitor thought of the product.
 *
 * The rating is optional because the sentence is the valuable part and a
 * required star rating is the commonest reason a feedback form is abandoned.
 */
export class CreateDemoFeedbackDto {
  @IsString()
  @MinLength(5)
  @MaxLength(5000)
  body: string;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(5)
  rating?: number;
}

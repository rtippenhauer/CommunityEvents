import { IsArray, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateReleaseDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^\d+\.\d+\.\d+$/, { message: 'version must be valid semver (e.g. 1.2.3)' })
  version?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(50000)
  body?: string;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  feedbackIds?: number[];
}

import { IsArray, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateReleaseDto {
  @IsString()
  @MaxLength(20)
  @Matches(/^\d+\.\d+\.\d+$/, { message: 'version must be valid semver (e.g. 1.2.3)' })
  version: string;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @IsString()
  @MinLength(10)
  @MaxLength(50000)
  body: string;

  @IsArray()
  @IsInt({ each: true })
  @IsOptional()
  feedbackIds?: number[];
}

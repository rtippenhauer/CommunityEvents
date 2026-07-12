import {
  IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min,
} from 'class-validator';

export class UpdateAchievementDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description: string;

  @IsString()
  @MaxLength(255)
  @IsOptional()
  icon?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  title?: string | null;

  @IsInt()
  @Min(0)
  @Max(127)
  points: number;

  @IsBoolean()
  isSecret: boolean;

  @IsInt()
  @Min(1)
  @IsOptional()
  progressTarget?: number | null;
}

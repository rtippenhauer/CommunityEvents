import {
  IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min,
} from 'class-validator';

export class CreateEventAchievementDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  title?: string;

  @IsInt()
  @Min(0)
  @Max(127)
  points: number;

  @IsString()
  @MaxLength(255)
  @IsOptional()
  icon?: string;

  @IsBoolean()
  @IsOptional()
  isSecret?: boolean;
}

import {
  IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min,
} from 'class-validator';
import { ProgressType } from '../../../database/enums';

export class CreateAchievementDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  key: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  icon: string;

  @IsIn(Object.values(ProgressType))
  progressType: ProgressType;

  @IsInt()
  @Min(1)
  @IsOptional()
  progressTarget?: number | null;

  @IsInt()
  @Min(0)
  @Max(127)
  points: number;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  title?: string | null;

  @IsBoolean()
  @IsOptional()
  isSecret?: boolean;
}

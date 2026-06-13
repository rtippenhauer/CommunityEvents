import { IsEnum, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { FlagContentType } from '../../../database/entities/content-flag.entity';

export class FlagContentDto {
  @IsEnum(FlagContentType)
  contentType: FlagContentType;

  @IsInt()
  contentId: number;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}

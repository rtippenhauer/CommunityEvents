import { IsEnum, IsInt, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';
import { ReportContentType } from '../../../database/enums';

export class CreateReportDto {
  @IsEnum(ReportContentType)
  contentType: ReportContentType;

  @IsInt()
  @IsPositive()
  contentId: number;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  reason?: string;
}

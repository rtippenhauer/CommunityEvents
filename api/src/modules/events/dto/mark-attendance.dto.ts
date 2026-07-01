import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional, ValidateNested } from 'class-validator';

export class AttendanceEntryDto {
  @IsInt()
  userId: number;

  @IsBoolean()
  attended: boolean;

  @IsOptional()
  @IsBoolean()
  fromOtherCity?: boolean;
}

export class MarkAttendanceDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttendanceEntryDto)
  attendances: AttendanceEntryDto[];
}

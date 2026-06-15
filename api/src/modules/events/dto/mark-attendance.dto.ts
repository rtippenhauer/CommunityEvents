import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, ValidateNested } from 'class-validator';

export class AttendanceEntryDto {
  @IsInt()
  userId: number;

  @IsBoolean()
  attended: boolean;
}

export class MarkAttendanceDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttendanceEntryDto)
  attendances: AttendanceEntryDto[];
}

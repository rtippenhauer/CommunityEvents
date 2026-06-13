import { IsArray, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, ArrayMaxSize } from 'class-validator';
import { RsvpStatus } from '../../../database/entities/event-rsvp.entity';

export class UpsertRsvpDto {
  @IsEnum(RsvpStatus)
  status: RsvpStatus = RsvpStatus.GOING;

  @IsInt()
  @Min(0)
  @Max(9)
  additionalGuests: number = 0;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  @ArrayMaxSize(9)
  guestNames?: string[];
}

import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { EventStatus } from '../../../database/entities/event.entity';

export class CreateEventDto {
  @IsInt()
  @IsPositive()
  cityId: number;

  @IsInt()
  @IsPositive()
  restaurantId: number;

  @IsString()
  @MaxLength(255)
  title: string;

  @IsString()
  @IsOptional()
  description?: string | null;

  @IsString()
  @IsOptional()
  additionalInfo?: string | null;

  @IsDateString()
  eventDate: string;

  @Matches(/^\d{2}:\d{2}$/)
  eventTime: string;

  @IsEnum(EventStatus)
  @IsOptional()
  status?: EventStatus;
}

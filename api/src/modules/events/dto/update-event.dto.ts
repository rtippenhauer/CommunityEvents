import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { EventStatus } from '../../../database/entities/event.entity';

export class UpdateEventDto {
  @IsInt()
  @IsPositive()
  @IsOptional()
  restaurantId?: number;

  @IsString()
  @MaxLength(255)
  @IsOptional()
  title?: string;

  @ValidateIf((o: UpdateEventDto) => o.description !== null)
  @IsString()
  @IsOptional()
  description?: string | null;

  @ValidateIf((o: UpdateEventDto) => o.additionalInfo !== null)
  @IsString()
  @IsOptional()
  additionalInfo?: string | null;

  @IsDateString()
  @IsOptional()
  eventDate?: string;

  @Matches(/^\d{2}:\d{2}$/)
  @IsOptional()
  eventTime?: string;

  @IsEnum(EventStatus)
  @IsOptional()
  status?: EventStatus;

  @ValidateIf((o: UpdateEventDto) => o.cancelledReason !== null)
  @IsString()
  @IsOptional()
  cancelledReason?: string | null;
}

import { IsEnum } from 'class-validator';
import { FlagStatus } from '../../../database/entities/content-flag.entity';

export class UpdateFlagDto {
  @IsEnum(FlagStatus)
  status: FlagStatus;
}

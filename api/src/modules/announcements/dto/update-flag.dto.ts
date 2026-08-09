import { IsEnum } from 'class-validator';
import { FlagStatus } from '../../../database/enums';

export class UpdateFlagDto {
  @IsEnum(FlagStatus)
  status: FlagStatus;
}

import { IsString, MaxLength } from 'class-validator';

export class UpdateAppConfigDto {
  @IsString()
  @MaxLength(60000)
  value: string;
}

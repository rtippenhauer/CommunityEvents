import { Type } from 'class-transformer';
import { IsArray, IsString, MaxLength, ValidateNested } from 'class-validator';

export class ConfigEntryDto {
  @IsString()
  @MaxLength(100)
  key: string;

  @IsString()
  @MaxLength(60000)
  value: string;
}

export class BulkUpdateAppConfigDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfigEntryDto)
  entries: ConfigEntryDto[];
}

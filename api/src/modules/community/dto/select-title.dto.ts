import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class SelectTitleDto {
  @ValidateIf((o: SelectTitleDto) => o.title !== null)
  @IsString()
  @MaxLength(100)
  @IsOptional()
  title?: string | null;
}

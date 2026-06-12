import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  content: string;

  @IsBoolean()
  @IsOptional()
  isAdminOnly?: boolean;
}

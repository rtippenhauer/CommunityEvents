import { IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAnnouncementDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50000)
  body: string;

  @IsInt()
  @IsOptional()
  cityId?: number | null;
}

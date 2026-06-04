import { IsInt, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsString()
  @MaxLength(200)
  @IsOptional()
  fullName?: string;

  @IsInt()
  @IsPositive()
  @IsOptional()
  cityId?: number;
}

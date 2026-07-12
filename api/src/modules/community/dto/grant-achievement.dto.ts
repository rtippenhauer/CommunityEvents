import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class GrantAchievementDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  key: string;
}

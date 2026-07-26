import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateAvatarLabelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label: string;
}

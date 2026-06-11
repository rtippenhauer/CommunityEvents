import { IsString, Matches } from 'class-validator';

export class SetAvatarDto {
  @IsString()
  @Matches(/^\/avatars\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/)
  avatarPath: string;
}

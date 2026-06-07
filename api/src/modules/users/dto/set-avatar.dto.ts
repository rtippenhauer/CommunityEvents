import { IsIn } from 'class-validator';

export const PRESET_AVATARS = [
  '/avatars/bear-chef.jpg',
  '/avatars/bear-flannel.jpg',
  '/avatars/bear-cool.jpg',
  '/avatars/bear-rainbow.jpg',
  '/avatars/bear-hoodie.jpg',
  '/avatars/bear-bookworm.jpg',
  '/avatars/bear-explorer.jpg',
  '/avatars/bear-musician.jpg',
  '/avatars/bear-athlete.jpg',
  '/avatars/bear-dapper.jpg',
  '/avatars/bear-astronaut.jpg',
  '/avatars/bear-artist.jpg',
  '/avatars/bear-disco.jpg',
  '/avatars/bear-karaoke.jpg',
] as const;

export class SetAvatarDto {
  @IsIn(PRESET_AVATARS)
  avatarPath: string;
}

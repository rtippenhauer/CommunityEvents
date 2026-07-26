import { IsString, Matches } from 'class-validator';

export class SetAvatarDto {
  // Format gate only — accepts a static preset (/avatars/…, shipped in the
  // image) or an uploaded one (/api/uploads/avatars/…). The authoritative
  // check that the path is really one of THIS instance's avatars happens in
  // UsersService.setAvatar against the avatar table, so a well-formed but
  // non-existent path is still rejected.
  @IsString()
  @Matches(
    /^(\/avatars\/[a-zA-Z0-9_-]+|\/api\/uploads\/avatars\/[a-zA-Z0-9_.-]+)\.(jpg|jpeg|png|webp|gif)$/,
  )
  avatarPath: string;
}

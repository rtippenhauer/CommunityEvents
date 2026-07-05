import { UserEntity } from '../../database/entities/user.entity';

export interface PublicUser {
  id: number;
  fullName: string;
  profilePhotoPath: string | null;
}

/**
 * Reduces a raw UserEntity (which has no @Exclude decorators and would
 * otherwise serialize password_hash, calendar_token, verification/reset
 * tokens, email, etc. straight into the HTTP response) down to the fields
 * safe to show to any other caller.
 */
export function toPublicUser(user: UserEntity | null | undefined): PublicUser | null {
  if (!user) return null;
  return { id: user.id, fullName: user.fullName, profilePhotoPath: user.profilePhotoPath };
}

/**
 * Same as toPublicUser, but for responses served to fully anonymous callers
 * (no login at all). Uploaded profile photos require a login to view
 * (ProfilePhotosController), so serving one here would just 401 in the
 * visitor's browser — this nulls it out instead. Preset avatars
 * (/avatars/bear-*.jpg) are static assets and always safe to show.
 */
export function toAnonSafeUser(user: UserEntity | null | undefined): PublicUser | null {
  const pub = toPublicUser(user);
  if (!pub) return null;
  const isPresetAvatar = pub.profilePhotoPath?.startsWith('/avatars/') ?? false;
  return { ...pub, profilePhotoPath: isPresetAvatar ? pub.profilePhotoPath : null };
}

/**
 * For "my own profile" responses — the caller is allowed to see most of
 * their own row, but there's no reason a profile JSON response should ever
 * carry live secrets: the password hash, active reset/verification tokens,
 * or the calendar feed token (fetched separately by the calendar settings
 * endpoint when actually needed).
 */
export function stripUserSecrets<T extends UserEntity>(user: T): Omit<T, 'passwordHash' | 'emailVerificationToken' | 'passwordResetToken' | 'calendarToken'> {
  const clone = { ...user };
  delete (clone as any).passwordHash;
  delete (clone as any).emailVerificationToken;
  delete (clone as any).passwordResetToken;
  delete (clone as any).calendarToken;
  return clone;
}

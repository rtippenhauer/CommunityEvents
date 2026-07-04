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

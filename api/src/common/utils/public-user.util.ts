/**
 * Structural, not tied to either ORM's user type. During the Prisma swap both
 * a TypeORM UserEntity and a Prisma `users` row get passed through here, and
 * they are not assignable to one another (their enum-typed columns differ), so
 * naming the three fields actually read keeps both callers working.
 */
interface UserLike {
  id: number;
  fullName: string;
  profilePhotoPath: string | null;
}

export interface PublicUser {
  id: number;
  fullName: string;
  profilePhotoPath: string | null;
}

/**
 * Reduces a raw user row (which has no @Exclude decorators and would
 * otherwise serialize password_hash, calendar_token, verification/reset
 * tokens, email, etc. straight into the HTTP response) down to the fields
 * safe to show to any other caller.
 */
export function toPublicUser(user: UserLike | null | undefined): PublicUser | null {
  if (!user) return null;
  return { id: user.id, fullName: user.fullName, profilePhotoPath: user.profilePhotoPath };
}

/**
 * Same as toPublicUser, but for responses served to fully anonymous callers
 * (no login at all). Uploaded profile photos require a login to view
 * (ProfilePhotosController), so serving one here would just 401 in the
 * visitor's browser — this nulls it out instead. Preset avatars are safe to
 * show: the static bear set (/avatars/*) and admin-uploaded ones
 * (/api/uploads/avatars/*) are both served without an auth check.
 */
export function toAnonSafeUser(user: UserLike | null | undefined): PublicUser | null {
  const pub = toPublicUser(user);
  if (!pub) return null;
  const path = pub.profilePhotoPath;
  const isPresetAvatar =
    (path?.startsWith('/avatars/') || path?.startsWith('/api/uploads/avatars/')) ?? false;
  return { ...pub, profilePhotoPath: isPresetAvatar ? path : null };
}

/**
 * For "my own profile" responses — the caller is allowed to see most of
 * their own row, but there's no reason a profile JSON response should ever
 * carry live secrets: the password hash, active reset/verification tokens,
 * or the calendar feed token (fetched separately by the calendar settings
 * endpoint when actually needed).
 */
export function stripUserSecrets<T extends object>(user: T): Omit<T, 'passwordHash' | 'emailVerificationToken' | 'passwordResetToken' | 'calendarToken'> {
  const clone = { ...user };
  delete (clone as any).passwordHash;
  delete (clone as any).emailVerificationToken;
  delete (clone as any).passwordResetToken;
  delete (clone as any).calendarToken;
  return clone;
}

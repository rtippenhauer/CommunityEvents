import { stripUserSecrets, toAnonSafeUser, toPublicUser } from './public-user.util';

/**
 * The only thing standing between a raw `users` row and the HTTP response.
 * There are no @Exclude decorators on the Prisma row, so anything these
 * functions fail to drop — password hash, reset and verification tokens, the
 * calendar feed token, email — goes out over the wire.
 *
 * The assertions below are deliberately written as "this key is absent" rather
 * than "these keys are present": a whitelist test still passes if a new secret
 * column starts leaking alongside the expected fields.
 */
const userRow = () => ({
  id: 1,
  fullName: 'Ada Lovelace',
  email: 'ada@example.test',
  profilePhotoPath: '/avatars/bear-BBQ.png',
  passwordHash: '$2b$12$notarealhash',
  emailVerificationToken: 'verify-token',
  passwordResetToken: 'reset-token',
  calendarToken: 'calendar-token',
  role: 'member',
});

describe('toPublicUser', () => {
  it('keeps only id, fullName and profilePhotoPath', () => {
    expect(toPublicUser(userRow())).toEqual({
      id: 1,
      fullName: 'Ada Lovelace',
      profilePhotoPath: '/avatars/bear-BBQ.png',
    });
  });

  it('drops the email and every credential field', () => {
    const out = toPublicUser(userRow()) as unknown as Record<string, unknown>;
    for (const secret of [
      'email',
      'passwordHash',
      'emailVerificationToken',
      'passwordResetToken',
      'calendarToken',
    ]) {
      expect(out).not.toHaveProperty(secret);
    }
  });

  it('returns null for null or undefined', () => {
    expect(toPublicUser(null)).toBeNull();
    expect(toPublicUser(undefined)).toBeNull();
  });
});

describe('toAnonSafeUser', () => {
  // Uploaded profile photos need a login to fetch, so handing one to an
  // anonymous caller just 401s in their browser. Preset avatars are public.
  it('keeps a static preset avatar', () => {
    const out = toAnonSafeUser({ ...userRow(), profilePhotoPath: '/avatars/bear-DJ.png' });
    expect(out?.profilePhotoPath).toBe('/avatars/bear-DJ.png');
  });

  it('keeps an admin-uploaded avatar', () => {
    const out = toAnonSafeUser({ ...userRow(), profilePhotoPath: '/api/uploads/avatars/x.png' });
    expect(out?.profilePhotoPath).toBe('/api/uploads/avatars/x.png');
  });

  it('nulls an uploaded profile photo', () => {
    const out = toAnonSafeUser({ ...userRow(), profilePhotoPath: '/api/uploads/profiles/x.png' });
    expect(out?.profilePhotoPath).toBeNull();
  });

  it('handles a user with no photo at all', () => {
    const out = toAnonSafeUser({ ...userRow(), profilePhotoPath: null });
    expect(out?.profilePhotoPath).toBeNull();
  });

  it('still drops the secrets toPublicUser drops', () => {
    const out = toAnonSafeUser(userRow()) as unknown as Record<string, unknown>;
    expect(out).not.toHaveProperty('passwordHash');
    expect(out).not.toHaveProperty('email');
  });

  it('returns null for null', () => {
    expect(toAnonSafeUser(null)).toBeNull();
  });
});

describe('stripUserSecrets', () => {
  // Used for "my own profile" responses: the caller may see most of their row,
  // but a profile payload has no reason to carry live credentials.
  it('removes the four secret fields', () => {
    const out = stripUserSecrets(userRow()) as unknown as Record<string, unknown>;
    expect(out).not.toHaveProperty('passwordHash');
    expect(out).not.toHaveProperty('emailVerificationToken');
    expect(out).not.toHaveProperty('passwordResetToken');
    expect(out).not.toHaveProperty('calendarToken');
  });

  it('keeps the fields the owner is allowed to see, including their email', () => {
    const out = stripUserSecrets(userRow());
    expect(out).toMatchObject({
      id: 1,
      fullName: 'Ada Lovelace',
      email: 'ada@example.test',
      role: 'member',
    });
  });

  it('does not mutate the row it was given', () => {
    // Callers pass the live row from the request context; blanking its fields
    // in place would affect whatever ran next in the same request.
    const original = userRow();
    stripUserSecrets(original);
    expect(original.passwordHash).toBe('$2b$12$notarealhash');
    expect(original.calendarToken).toBe('calendar-token');
  });
});

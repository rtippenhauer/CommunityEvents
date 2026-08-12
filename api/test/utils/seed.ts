import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { cities as City, locations as Location, users as User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../src/database/prisma/prisma.service';
import { UserRole, UserStatus } from '../../src/database/enums';
import { AuthService } from '../../src/modules/auth/auth.service';

// Overrides are typed against Prisma's *Unchecked* create inputs rather than
// the checked ones so specs can keep passing plain FK scalars (cityId,
// createdById) the way they passed them to the TypeORM repositories. The
// checked inputs would demand nested `connect` objects instead.
type CityOverrides = Partial<Prisma.citiesUncheckedCreateInput>;
type LocationOverrides = Partial<Prisma.locationsUncheckedCreateInput>;
type UserOverrides = Partial<Prisma.usersUncheckedCreateInput>;

// Shared across specs that need a real bcrypt hash on a seeded user (login,
// password reset/change, etc.) — same cost factor AuthService uses (12).
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

let counter = 0;
function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export async function seedCity(prisma: PrismaService, overrides: CityOverrides = {}): Promise<City> {
  return prisma.cities.create({
    data: {
      name: overrides.name ?? `Test City ${unique('city')}`,
      subdomain: overrides.subdomain ?? unique('city').toLowerCase().replace(/[^a-z0-9-]/g, ''),
      isActive: overrides.isActive ?? true,
    },
  });
}

export async function seedLocation(
  prisma: PrismaService,
  cityId: number,
  overrides: LocationOverrides = {},
): Promise<Location> {
  return prisma.locations.create({
    data: {
      name: overrides.name ?? `Test Location ${unique('location')}`,
      address: overrides.address ?? '123 Test St, Test City, OH 45202',
      cityId,
      ...overrides,
    },
  });
}

export async function seedUser(
  prisma: PrismaService,
  cityId: number,
  overrides: UserOverrides = {},
): Promise<User> {
  return prisma.users.create({
    data: {
      fullName: overrides.fullName ?? 'Test User',
      email: overrides.email ?? `${unique('user')}@example.test`,
      cityId,
      role: overrides.role ?? UserRole.MEMBER,
      status: overrides.status ?? UserStatus.ACTIVE,
      ...overrides,
    },
  });
}

// Issues a real session (JWT + persisted login_sessions row) the same way a
// real login would — required because JwtStrategy checks the session table by
// jti, not just the JWT signature. Returns the cookie header value to attach
// to supertest requests via .set('Cookie', ...).
export async function loginAs(app: INestApplication, user: User): Promise<string> {
  const authService = app.get(AuthService);
  const { accessToken } = await authService.issueTokens(user, {
    userAgent: 'jest-e2e',
    ipAddress: '127.0.0.1',
  });
  return `access_token=${accessToken}`;
}

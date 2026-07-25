import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { CityEntity } from '../../src/database/entities/city.entity';
import { UserEntity, UserRole, UserStatus } from '../../src/database/entities/user.entity';
import { LocationEntity } from '../../src/database/entities/location.entity';
import { AuthService } from '../../src/modules/auth/auth.service';

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

export async function seedCity(dataSource: DataSource, overrides: Partial<CityEntity> = {}): Promise<CityEntity> {
  const repo = dataSource.getRepository(CityEntity);
  return repo.save(
    repo.create({
      name: overrides.name ?? `Test City ${unique('city')}`,
      subdomain: overrides.subdomain ?? unique('city').toLowerCase().replace(/[^a-z0-9-]/g, ''),
      isActive: overrides.isActive ?? true,
    }),
  );
}

export async function seedLocation(
  dataSource: DataSource,
  cityId: number,
  overrides: Partial<LocationEntity> = {},
): Promise<LocationEntity> {
  const repo = dataSource.getRepository(LocationEntity);
  return repo.save(
    repo.create({
      name: overrides.name ?? `Test Location ${unique('location')}`,
      address: overrides.address ?? '123 Test St, Test City, OH 45202',
      cityId,
      ...overrides,
    }),
  );
}

export async function seedUser(
  dataSource: DataSource,
  cityId: number,
  overrides: Partial<UserEntity> = {},
): Promise<UserEntity> {
  const repo = dataSource.getRepository(UserEntity);
  return repo.save(
    repo.create({
      fullName: overrides.fullName ?? 'Test User',
      email: overrides.email ?? `${unique('user')}@example.test`,
      cityId,
      role: overrides.role ?? UserRole.MEMBER,
      status: overrides.status ?? UserStatus.ACTIVE,
      ...overrides,
    }),
  );
}

// Issues a real session (JWT + persisted LoginSessionEntity row) the same
// way a real login would — required because JwtStrategy checks the session
// table by jti, not just the JWT signature. Returns the cookie header value
// to attach to supertest requests via .set('Cookie', ...).
export async function loginAs(app: INestApplication, user: UserEntity): Promise<string> {
  const authService = app.get(AuthService);
  const { accessToken } = await authService.issueTokens(user, {
    userAgent: 'jest-e2e',
    ipAddress: '127.0.0.1',
  });
  return `access_token=${accessToken}`;
}

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma/prisma.service';
import { runUnscoped, runWithTenant } from '../../common/tenant/tenant-store';
import { EmailStatus, UserRole, UserStatus } from '../../database/enums';
import { AUTOMATION_ACCOUNT_EMAIL } from '../../common/utils/service-account.util';
import { AuditService } from '../audit/audit.service';
import {
  CreateTenantUserDto,
  ResetTenantUserPasswordDto,
  UpdateTenantUserDto,
} from './dto/tenant-user.dto';

/** Matches AuthService.register, so a hash made here verifies like any other. */
const BCRYPT_ROUNDS = 12;

export interface TenantUserRow {
  id: number;
  fullName: string;
  email: string;
  role: string;
  status: string;
  emailVerified: boolean;
  isServiceAccount: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}

/**
 * Managing the people inside a community, from outside it.
 *
 * This exists because of a gap the tenant registry created: a system admin can
 * create a community but has no account in it, and a community's own admin
 * screens live on that community's host behind a session for that community. If
 * its only admin leaves, forgets their password, or was never created, nobody
 * can reach it and there is no path back. Suspending or deleting the whole
 * community was the only remaining lever, which is not a fix.
 *
 * Every method takes the tenant id from the route and does its work inside
 * `runWithTenant`, so the scoping extension filters the queries rather than
 * this service hand-writing `tenantId` into each one. That also means a user id
 * from one community cannot be acted on through another's route: the lookup
 * simply finds nothing.
 *
 * Two things it deliberately cannot do. It cannot touch a **service account** --
 * those are the deployment's own row in each community, guarded everywhere else
 * by `is_service_account`, and the root one's role flip already has its own
 * path. And it cannot grant or remove **system_admin**, matching
 * admin.service.setRole: a screen that manages one community must not be a
 * dropdown away from operating all of them.
 */
@Injectable()
export class TenantUsersService {
  private readonly logger = new Logger(TenantUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findAll(tenantId: number): Promise<TenantUserRow[]> {
    await this.assertTenantExists(tenantId);
    const users = await runWithTenant(tenantId, async () =>
      await this.prisma.users.findMany({
        orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          status: true,
          emailVerifiedAt: true,
          isServiceAccount: true,
          createdAt: true,
          lastLoginAt: true,
        },
      }),
    );

    return users.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      role: u.role,
      status: u.status,
      emailVerified: u.emailVerifiedAt !== null,
      isServiceAccount: u.isServiceAccount,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
    }));
  }

  async create(
    tenantId: number,
    dto: CreateTenantUserDto,
    actorId: number,
  ): Promise<TenantUserRow> {
    await this.assertTenantExists(tenantId);

    const email = dto.email.trim().toLowerCase();
    if (email === AUTOMATION_ACCOUNT_EMAIL) {
      throw new BadRequestException('That address is reserved for the community service account.');
    }

    // Per-tenant uniqueness (REQ-TENANT-01.5): the same address may hold an
    // account in every community, so this is findFirst inside the tenant rather
    // than a global findUnique.
    const clash = await runWithTenant(tenantId, async () =>
      await this.prisma.users.findFirst({ where: { email }, select: { id: true } }),
    );
    if (clash) {
      throw new BadRequestException(`${email} already has an account in this community.`);
    }

    const city = await this.prisma.cities.findFirst({ orderBy: { id: 'asc' } });
    if (!city) {
      throw new BadRequestException('No city exists to attach the account to. Run the seed first.');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    // runUnscoped with an explicit tenantId, matching how the first admin and
    // the service account are created: the row belongs to the community being
    // administered while the request is scoped to the root one.
    const created = await runUnscoped('creating a user inside a managed community', async () =>
      await this.prisma.users.create({
        data: {
          tenantId,
          cityId: city.id,
          fullName: dto.fullName.trim() || 'Member',
          email,
          passwordHash,
          role: dto.role ?? UserRole.MEMBER,
          status: UserStatus.ACTIVE,
          // Verified on creation, like the first admin: the operator vouches
          // for the address by typing it, and an unverified account on a
          // community with no admin has nobody to ask for help.
          emailStatus: EmailStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      }),
    );

    await this.log(actorId, 'tenant.user.create', tenantId, created.id, {
      email,
      role: created.role,
    });

    return (await this.findAll(tenantId)).find((u) => u.id === created.id)!;
  }

  async update(
    tenantId: number,
    userId: number,
    dto: UpdateTenantUserDto,
    actorId: number,
  ): Promise<TenantUserRow> {
    const target = await this.requireUser(tenantId, userId);

    const data: { role?: UserRole; status?: UserStatus } = {};
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.status !== undefined) data.status = dto.status;
    if (Object.keys(data).length === 0) return target;

    await runWithTenant(tenantId, async () => {
      await this.prisma.users.update({ where: { id: userId }, data });
    });

    await this.log(actorId, 'tenant.user.update', tenantId, userId, {
      ...(data.role ? { role: { from: target.role, to: data.role } } : {}),
      ...(data.status ? { status: { from: target.status, to: data.status } } : {}),
    });

    return this.requireUser(tenantId, userId);
  }

  async resetPassword(
    tenantId: number,
    userId: number,
    dto: ResetTenantUserPasswordDto,
    actorId: number,
  ): Promise<{ ok: true }> {
    const target = await this.requireUser(tenantId, userId);
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    await runWithTenant(tenantId, async () => {
      await this.prisma.users.update({
        where: { id: userId },
        data: {
          passwordHash,
          // Any outstanding reset link is invalidated: the operator has just
          // set a password out of band, and leaving a live token would let
          // whoever holds it overwrite that immediately.
          passwordResetToken: null,
          passwordResetExpiresAt: null,
        },
      });
    });

    await this.log(actorId, 'tenant.user.password_reset', tenantId, userId, {
      email: target.email,
    });
    this.logger.warn(
      `Password for ${target.email} (tenant ${tenantId}) was reset by system admin ${actorId}.`,
    );
    return { ok: true };
  }

  /**
   * Loads a user within a community, refusing the ones this surface may not act
   * on. The tenant filter comes from the extension, so a user id belonging to a
   * different community is simply not found.
   */
  private async requireUser(tenantId: number, userId: number): Promise<TenantUserRow> {
    await this.assertTenantExists(tenantId);
    const all = await this.findAll(tenantId);
    const target = all.find((u) => u.id === userId);
    if (!target) throw new NotFoundException('User not found in this community');

    if (target.isServiceAccount) {
      throw new BadRequestException(
        'That is the community service account and is managed by the deployment, not here.',
      );
    }
    if (target.role === UserRole.SYSTEM_ADMIN) {
      throw new BadRequestException(
        'System administrators are not managed from a community screen.',
      );
    }
    return target;
  }

  private async assertTenantExists(tenantId: number): Promise<void> {
    const tenant = await this.prisma.tenants.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
  }

  /**
   * Audit entries land on the ROOT tenant, not the community acted upon.
   *
   * `audit_log` is scoped, and the point of these entries is that the system
   * admin's actions on other communities are reviewable in one place -- writing
   * them into the community would scatter them and hand that community's own
   * admin an edit history of the operator. The community id is in the metadata.
   */
  private async log(
    actorId: number,
    action: string,
    tenantId: number,
    userId: number,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService.log({
      userId: actorId,
      action,
      entityType: 'user',
      entityId: userId,
      metadata: { tenantId, ...metadata },
    });
  }
}

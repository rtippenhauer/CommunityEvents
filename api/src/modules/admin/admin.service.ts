import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import {
  InviteType,
  SuppressionReason,
  UserRole,
  UserStatus,
} from '../../database/enums';
import { assertNotServiceAccount } from '../../common/utils/service-account.util';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { hasAdminRights } from '../../common/utils/roles.util';

export interface AdminUserRow {
  id: number;
  fullName: string;
  email: string;
  role: string;
  status: string;
  emailStatus: string;
  cityId: number;
  profilePhotoPath: string | null;
  invitedById: number | null;
  invitedByName: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  loginCount: number;
  oauthProviders: Array<{ provider: string; providerId: string; email: string | null }>;
  isPendingInvite: boolean;
  inviteExpiresAt: Date | null;
  hasMembership: boolean;
  membershipExpiresAt: Date | null;
}

export interface AuditLogFilter {
  action?: string;
  userId?: number;
  userSearch?: string;
  entityType?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

export interface AuditLogRow {
  id: number;
  userId: number | null;
  userName: string | null;
  action: string;
  entityType: string | null;
  entityId: number | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: Date;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly emailService: EmailService,
  ) {}

  async getUsers(): Promise<AdminUserRow[]> {
    // The inviter's name comes from a self-join. Prisma exposes it as the
    // users -> users relation on invited_by, named `users` because the entity
    // never declared a property for it (only the scalar invitedBy), so
    // introspection had no better name to take.
    const rows = await this.prisma.users.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        status: true,
        emailStatus: true,
        cityId: true,
        profilePhotoPath: true,
        invitedBy: true,
        createdAt: true,
        lastLoginAt: true,
        loginCount: true,
        hasMembership: true,
        membershipExpiresAt: true,
        users: { select: { fullName: true } },
      },
    });

    const users = rows.map(({ users: inviter, invitedBy, ...rest }) => ({
      ...rest,
      invitedById: invitedBy,
      invitedByName: inviter?.fullName ?? null,
    })) as Omit<AdminUserRow, 'oauthProviders' | 'isPendingInvite' | 'inviteExpiresAt'>[];

    const oauthAccounts = await this.prisma.oauth_accounts.findMany({
      select: { userId: true, provider: true, providerId: true, email: true },
    });

    const oauthByUser = new Map<number, Array<{ provider: string; providerId: string; email: string | null }>>();
    for (const acc of oauthAccounts) {
      const list = oauthByUser.get(acc.userId) ?? [];
      list.push({ provider: acc.provider, providerId: acc.providerId, email: acc.email });
      oauthByUser.set(acc.userId, list);
    }

    const userRows: AdminUserRow[] = users.map((u) => ({
      ...u,
      oauthProviders: oauthByUser.get(u.id) ?? [],
      isPendingInvite: false,
      inviteExpiresAt: null,
    }));

    const pendingInviteRows = await this.getPendingInviteRows();

    return [...userRows, ...pendingInviteRows];
  }

  // Single-use, named-invitee "member" invites that haven't been accepted yet —
  // shown alongside real users so admins don't have to cross-reference the
  // separate Invites tab to see who's been invited but hasn't joined.
  private async getPendingInviteRows(): Promise<AdminUserRow[]> {
    const invites = await this.prisma.invites.findMany({
      where: { type: InviteType.MEMBER, redeemedAt: null, isRevoked: false },
      include: { creator: true },
      orderBy: { createdAt: 'desc' },
    });

    return invites
      .map((i) => ({
        id: -i.id, // negative id keeps pending-invite rows out of real-user id space
        fullName: i.boundToName ?? i.boundToEmail ?? 'Invited member',
        email: i.boundToEmail ?? '',
        role: 'invited',
        status: i.expiresAt < new Date() ? 'invite_expired' : 'invite_pending',
        emailStatus: 'n/a',
        cityId: i.cityId ?? 0,
        profilePhotoPath: null,
        invitedById: i.createdBy,
        invitedByName: i.creator?.fullName ?? null,
        createdAt: i.createdAt,
        lastLoginAt: null,
        loginCount: 0,
        oauthProviders: [],
        isPendingInvite: true,
        inviteExpiresAt: i.expiresAt,
        hasMembership: false,
        membershipExpiresAt: null,
      }));
  }

  async getAuditLog(filter: AuditLogFilter): Promise<{ data: AuditLogRow[]; total: number }> {
    const page = Math.max(1, filter.page ?? 1);
    const limit = Math.min(200, Math.max(1, filter.limit ?? 50));
    const skip = (page - 1) * limit;

    // audit_log.user_id carries no foreign key, so schema.prisma models no
    // `user` relation and a nested relation filter is not available (this used
    // to be a hand-written join on an explicit condition). The name/email
    // search therefore resolves to a set of user ids first, and the audit query
    // filters on those. An empty result set is meaningful: it matches nothing,
    // which is what a search with no matching member should return.
    const searchUserIds = filter.userSearch
      ? (
          await this.prisma.users.findMany({
            where: {
              OR: [
                { fullName: { contains: filter.userSearch } },
                { email: { contains: filter.userSearch } },
              ],
            },
            select: { id: true },
          })
        ).map((u) => u.id)
      : null;

    // The filter builder becomes one reusable where object.
    const where: Prisma.audit_logWhereInput = {
      ...(filter.userId ? { userId: filter.userId } : {}),
      ...(searchUserIds ? { userId: { in: searchUserIds } } : {}),
      ...(filter.entityType ? { entityType: filter.entityType } : {}),
      ...(filter.action ? { action: filter.action } : {}),
      ...(filter.dateFrom || filter.dateTo
        ? {
            createdAt: {
              ...(filter.dateFrom ? { gte: new Date(filter.dateFrom) } : {}),
              ...(filter.dateTo ? { lte: new Date(filter.dateTo) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.audit_log.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.audit_log.count({ where }),
    ]);

    // audit_log.user_id has no foreign key in the database, so there is no
    // relation to include -- the query builder joined users on an explicit
    // condition instead. The names are fetched in one extra query keyed by the
    // ids on this page, rather than one lookup per row.
    const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is number => id !== null))];
    const names = userIds.length
      ? await this.prisma.users.findMany({
          where: { id: { in: userIds } },
          select: { id: true, fullName: true },
        })
      : [];
    const nameById = new Map(names.map((u) => [u.id, u.fullName]));

    const data = rows.map((r) => ({
      ...r,
      userName: r.userId === null ? null : nameById.get(r.userId) ?? null,
    })) as AuditLogRow[];

    return { data, total };

  }

  async getInviteLineage(): Promise<object[]> {
    const users = await this.prisma.users.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        fullName: true,
        invitedBy: true,
        createdAt: true,
        role: true,
        status: true,
      },
    });

    // createdAt is re-exposed as joinedAt, which is what the select alias did.
    const byId = new Map(
      users.map((u) => [
        u.id,
        { ...u, joinedAt: u.createdAt, invitedMembers: [] as object[] },
      ]),
    );

    const roots: object[] = [];
    for (const u of byId.values()) {
      if (u.invitedBy && byId.has(u.invitedBy)) {
        (byId.get(u.invitedBy)!.invitedMembers as object[]).push(u);
      } else {
        roots.push(u);
      }
    }
    return roots;
  }

  async isEmailSuppressed(userId: number): Promise<boolean> {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) return false;
    return this.emailService.isSuppressed(user.email);
  }

  async suppressUserEmail(userId: number, actorId: number): Promise<void> {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    await this.emailService.suppress(user.email, SuppressionReason.UNSUBSCRIBED);
    await this.auditService.log({ userId: actorId, action: 'admin.suppress_email', entityType: 'user', entityId: userId });
  }

  async liftEmailSuppression(userId: number, actorId: number): Promise<void> {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    await this.emailService.removeSuppression(user.email);
    await this.auditService.log({ userId: actorId, action: 'admin.lift_suppression', entityType: 'user', entityId: userId });
  }

  async banUser(targetId: number, actorId: number, actorRole: UserRole): Promise<void> {
    const target = await this.prisma.users.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');
    if (target.id === actorId) throw new BadRequestException('Cannot ban yourself');
    if (hasAdminRights(target.role)) throw new ForbiddenException('Cannot ban an admin');
    assertNotServiceAccount(target, 'ban');
    if (actorRole === UserRole.MODERATOR && target.role !== UserRole.MEMBER) {
      throw new ForbiddenException('Moderators can only ban regular members');
    }
    if (target.status === UserStatus.SUSPENDED) throw new BadRequestException('User is already banned');
    await this.prisma.users.update({ where: { id: targetId }, data: { status: UserStatus.SUSPENDED } });
    await this.auditService.log({ userId: actorId, action: 'user.ban', entityType: 'user', entityId: targetId });
  }

  async forceBanUser(targetId: number, actorId: number): Promise<void> {
    const target = await this.prisma.users.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');
    if (target.id === actorId) throw new BadRequestException('Cannot ban yourself');
    if (hasAdminRights(target.role)) throw new ForbiddenException('Cannot ban an admin');
    assertNotServiceAccount(target, 'ban');
    await this.prisma.users.update({ where: { id: targetId }, data: {
      status: UserStatus.DELETED,
      deletedAt: new Date(),
    } });
    await this.auditService.log({ userId: actorId, action: 'user.force_ban', entityType: 'user', entityId: targetId });
  }

  async unbanUser(targetId: number, actorId: number): Promise<void> {
    const target = await this.prisma.users.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');
    if (target.status === UserStatus.ACTIVE) throw new BadRequestException('User is not banned');
    await this.prisma.users.update({ where: { id: targetId }, data: { status: UserStatus.ACTIVE, deletedAt: null } });
    await this.auditService.log({ userId: actorId, action: 'user.unban', entityType: 'user', entityId: targetId });
  }

  async devDeleteUser(targetId: number, actorId: number): Promise<void> {
    const target = await this.prisma.users.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');
    if (target.id === actorId) throw new BadRequestException('Cannot delete yourself');
    if (hasAdminRights(target.role)) throw new ForbiddenException('Cannot delete an admin');
    assertNotServiceAccount(target, 'delete');

    await this.prisma.oauth_accounts.deleteMany({ where: { userId: targetId } });

    await this.prisma.users.update({
      where: { id: targetId },
      data: {
        status: UserStatus.DELETED,
        deletedAt: new Date(),
        email: `deleted_${targetId}@deleted.invalid`,
      },
    });
    await this.auditService.log({ userId: actorId, action: 'user.admin_delete', entityType: 'user', entityId: targetId });
  }

  async setRole(targetId: number, actorId: number, role: UserRole): Promise<void> {
    const target = await this.prisma.users.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');
    if (target.id === actorId) throw new BadRequestException('Cannot change your own role');
    // system_admin is never handed out or taken away here. It is the role that
    // manages every tenant on the deployment, so granting it from a per-tenant
    // admin screen would make "admin of one community" one click away from
    // "operator of all of them". bootstrap.ts creates the first one; any
    // further one is a deliberate database edit, exactly as admin already is.
    if (role === UserRole.SYSTEM_ADMIN || target.role === UserRole.SYSTEM_ADMIN) {
      throw new ForbiddenException('The system administrator role is not assignable here');
    }

    // Service accounts on ordinary tenants hold `disabled` and stay there.
    // There is nothing for them to do on those tenants, and a role change is the
    // only way an account that cannot be deleted could be turned into one that
    // can act -- so the two protections are worth exactly as much as each other.
    // The root tenant's account is the deliberate exception below.
    if (target.isServiceAccount && target.role === UserRole.DISABLED) {
      throw new ForbiddenException('Cannot change the role of a disabled service account');
    }

    // That exception: the root tenant's automation account. Rob can flip it up
    // to admin via the UI to let it browse role-gated pages for testing, then
    // flip it back down. Regular members still require a direct DB edit to be
    // promoted to admin, and other admins' roles can't be changed here at all.
    //
    // Keyed on is_service_account rather than the fixed automation email it used
    // to compare against: the role is by definition in flux here (that is the
    // point of the exception) and the email is branding v2-9 rewrites.
    if (hasAdminRights(target.role) && !target.isServiceAccount) {
      throw new ForbiddenException("Cannot change another admin's role");
    }
    if (role === UserRole.ADMIN && target.role !== UserRole.AUTOMATION) {
      throw new ForbiddenException('Cannot promote to admin — set directly in the database');
    }
    const previousRole = target.role;
    await this.prisma.users.update({ where: { id: targetId }, data: { role } });
    await this.auditService.log({
      userId: actorId,
      action: 'user.role_change',
      entityType: 'user',
      entityId: targetId,
      metadata: { from: previousRole, to: role },
    });
  }

  // Membership fee (Phase 35). Admin/moderator marks a member as having paid
  // dues; an explicit expiresAt overrides the default (Jan 1 of the following
  // year, computed in Eastern time so a payment recorded late on Dec 31
  // doesn't roll two Januaries out). Turning membership off clears the
  // expiration too, rather than leaving a stale date around.
  async setMembership(
    targetId: number,
    actorId: number,
    hasMembership: boolean,
    expiresAt?: string,
  ): Promise<{ hasMembership: boolean; membershipExpiresAt: Date | null }> {
    const target = await this.prisma.users.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');

    const membershipExpiresAt = hasMembership
      ? (expiresAt ? new Date(expiresAt) : nextJanuaryFirstEastern())
      : null;
    await this.prisma.users.update({ where: { id: targetId }, data: { hasMembership, membershipExpiresAt } });
    await this.auditService.log({
      userId: actorId,
      action: 'user.membership_change',
      entityType: 'user',
      entityId: targetId,
      metadata: { hasMembership, membershipExpiresAt },
    });
    return { hasMembership, membershipExpiresAt };
  }
}

function nextJanuaryFirstEastern(): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
  }).formatToParts(new Date());
  const currentYear = Number(parts.find((p) => p.type === 'year')!.value);
  return new Date(`${currentYear + 1}-01-01T00:00:00`);
}

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { unlink } from 'fs/promises';
import { join } from 'path';
import type { users as User } from '@prisma/client';
import { requireTenantId } from '../../common/tenant/tenant-store';
import { PrismaService } from '../../database/prisma/prisma.service';
import { EmailStatus, UserRole, UserStatus } from '../../database/enums';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { EmailTemplate } from '../email/email.constants';
import { AvatarsService } from '../avatars/avatars.service';
import { stripUserSecrets } from '../../common/utils/public-user.util';
import { coerceRawRows } from '../../common/utils/prisma-raw.util';
import { hasAdminRights, isElevatedRole } from '../../common/utils/roles.util';
import {
  assertNotServiceAccount,
  EXCLUDE_SERVICE_ACCOUNTS_SQL,
} from '../../common/utils/service-account.util';

// Shape of the raw findMembers rows. MySQL returns the computed columns as
// strings or numbers depending on the driver, so the mapper below coerces
// rather than trusting them.
interface MemberRow {
  id: number;
  fullName: string;
  profilePhotoPath: string | null;
  selectedTitle: string | null;
  cityId: number | null;
  cityName: string | null;
  joinedAt: Date;
  isNew: number;
  invitedById: number | null;
  invitedByName: string | null;
  invitedByPhoto: string | null;
  totalPoints: string | number | null;
  role?: string;
  status?: string;
  facebookId?: string | null;
  facebookProfileUrl?: string | null;
  googleEmail?: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly emailService: EmailService,
    private readonly avatarsService: AvatarsService,
  ) {}

  async findById(id: number) {
    const user = await this.prisma.users.findUnique({
      where: { id },
      include: { city: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return stripUserSecrets(user);
  }

  async updateProfile(user: User, dto: UpdateProfileDto) {
    const saved = await this.prisma.users.update({
      where: { id: user.id },
      data: {
        ...(dto.fullName ? { fullName: dto.fullName } : {}),
        ...(dto.cityId ? { cityId: dto.cityId } : {}),
        ...(dto.profilePhotoPath === null ? { profilePhotoPath: null } : {}),
      },
    });
    return stripUserSecrets(saved);
  }

  async updatePhotoPath(userId: number, path: string): Promise<void> {
    await this.prisma.users.update({ where: { id: userId }, data: { profilePhotoPath: path } });
  }

  async setAvatar(userId: number, avatarPath: string): Promise<{ url: string }> {
    // Authoritative check: the path must be one of THIS instance's preset
    // avatars (avatar table), not just well-formed — otherwise a member could
    // point their photo at any /avatars/… or /api/uploads/avatars/… path.
    if (!(await this.avatarsService.pathExists(avatarPath))) {
      throw new BadRequestException('Unknown avatar');
    }
    await this.prisma.users.update({
      where: { id: userId },
      data: { profilePhotoPath: avatarPath },
    });
    return { url: avatarPath };
  }

  async updateEmailStatus(userId: number, status: EmailStatus): Promise<void> {
    await this.prisma.users.update({ where: { id: userId }, data: { emailStatus: status } });
  }

  async findMembers(viewerRole: UserRole, sort: 'newest' | 'alpha' = 'newest'): Promise<object[]> {
    const isNonValidated = viewerRole === UserRole.NON_VALIDATED;
    const isElevated = isElevatedRole(viewerRole);
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    // Kept as SQL rather than rebuilt with the query API. It carries a
    // correlated subquery for the points total, a MySQL IF() for the isNew
    // flag, and two conditional self-joins on oauth_accounts -- none of which
    // Prisma expresses without either several extra round trips or computing
    // in Node what the database already computes in one pass.
    //
    // The joins and select list are assembled the same way the query builder
    // assembled them, and every value is still bound as a parameter.
    const elevatedColumns = isElevated
      ? `,
        u.role AS role,
        u.status AS status,
        fb.provider_id AS facebookId,
        fb.profile_url AS facebookProfileUrl,
        gg.email AS googleEmail`
      : '';

    // Raw SQL is not routed through the tenant-scoping extension, so the two
    // scoped tables referenced here — member_points and oauth_accounts — carry
    // their own predicate. Both are LEFT JOIN / correlated-subquery reads, so
    // the filter goes in the ON or subquery clause rather than the WHERE, which
    // would drop members who have no points or no linked provider.
    //
    // `users` itself is filtered too, as of v2-6. Before REQ-TENANT-01.5 gave it
    // a tenant_id this list spanned every tenant, and only what each row
    // *reported* was scoped to the requesting one.
    const tenantId = requireTenantId('member directory');

    const elevatedJoins = isElevated
      ? `
      LEFT JOIN oauth_accounts fb ON fb.user_id = u.id AND fb.provider = 'facebook' AND fb.tenant_id = ?
      LEFT JOIN oauth_accounts gg ON gg.user_id = u.id AND gg.provider = 'google' AND gg.tenant_id = ?`
      : '';

    const orderBy =
      sort === 'alpha' ? 'u.full_name ASC' : 'u.created_at DESC, u.full_name ASC';

    const statusClause = isElevated ? 'u.status != ?' : 'u.status = ?';
    const statusValue = isElevated ? UserStatus.DELETED : UserStatus.ACTIVE;

    const rows = await this.prisma.$queryRawUnsafe<MemberRow[]>(
      `SELECT
        u.id AS id,
        u.full_name AS fullName,
        u.profile_photo_path AS profilePhotoPath,
        u.selected_title AS selectedTitle,
        u.city_id AS cityId,
        city.name AS cityName,
        u.created_at AS joinedAt,
        IF(u.created_at >= ?, 1, 0) AS isNew,
        u.invited_by AS invitedById,
        inviter.full_name AS invitedByName,
        inviter.profile_photo_path AS invitedByPhoto,
        (SELECT COALESCE(SUM(mp.points), 0) FROM member_points mp
          WHERE mp.user_id = u.id AND mp.tenant_id = ?)
          AS totalPoints${elevatedColumns}
      FROM users u
      -- No predicate on the inviter join: an inviter belongs to the same tenant
      -- as the member they invited, and the driving table is filtered below. It
      -- is a LEFT JOIN besides, so a filter here would only be able to blank the
      -- inviter name, never to widen the result.
      LEFT JOIN users inviter ON inviter.id = u.invited_by
      LEFT JOIN cities city ON city.id = u.city_id${elevatedJoins}
      WHERE u.tenant_id = ?
        AND ${statusClause}
        AND ${EXCLUDE_SERVICE_ACCOUNTS_SQL}
      ORDER BY ${orderBy}`,
      // Positional and assembled in the order the placeholders appear: the
      // isNew cutoff, the points subquery's tenant, then the two oauth joins'
      // tenants (only present when the elevated joins are), then the directory's
      // own tenant filter and the status.
      twoWeeksAgo,
      tenantId,
      ...(isElevated ? [tenantId, tenantId] : []),
      tenantId,
      statusValue,
    );

    return coerceRawRows(rows).map((r) => ({
      id: r.id,
      fullName: isNonValidated ? 'Mystery Bear' : r.fullName,
      profilePhotoPath: isNonValidated ? null : r.profilePhotoPath,
      selectedTitle: isNonValidated ? null : (r.selectedTitle ?? null),
      cityId: r.cityId,
      cityName: r.cityName ?? null,
      joinedAt: r.joinedAt,
      isNew: Boolean(r.isNew),
      totalPoints: Number(r.totalPoints) || 0,
      invitedBy: isNonValidated ? null : (r.invitedById
        ? { id: r.invitedById, fullName: r.invitedByName, profilePhotoPath: r.invitedByPhoto }
        : null),
      ...(isElevated ? {
        role: r.role,
        status: r.status,
        facebookProfileUrl: r.facebookProfileUrl ?? null,
        hasFacebook: !!r.facebookId,
        googleEmail: r.googleEmail ?? null,
      } : {}),
    }));
  }

  async findMemberProfile(
    id: number,
    viewerId: number,
    viewerRole: UserRole,
  ): Promise<object> {
    if (viewerRole === UserRole.NON_VALIDATED) {
      throw new ForbiddenException('Member profiles are not available to non-validated accounts');
    }

    const user = await this.prisma.users.findUnique({
      where: { id },
      include: { city: true },
    });
    if (!user || user.status === UserStatus.DELETED) throw new NotFoundException('Member not found');

    const isElevated = isElevatedRole(viewerRole);
    const isSelf = viewerId === id;

    let invitedByInfo: { id: number; fullName: string; profilePhotoPath: string | null } | null = null;
    if (user.invitedBy) {
      const inviter = await this.prisma.users.findUnique({ where: { id: user.invitedBy } });
      if (inviter) {
        invitedByInfo = { id: inviter.id, fullName: inviter.fullName, profilePhotoPath: inviter.profilePhotoPath };
      }
    }

    let invitedMembers: Array<{ id: number; fullName: string; profilePhotoPath: string | null }> = [];
    if (isSelf || isElevated) {
      const members = await this.prisma.users.findMany({
        where: { invitedBy: id, status: { not: UserStatus.DELETED } },
        select: { id: true, fullName: true, profilePhotoPath: true },
        orderBy: { createdAt: 'asc' },
      });
      invitedMembers = members.map((m) => ({
        id: m.id,
        fullName: m.fullName,
        profilePhotoPath: m.profilePhotoPath,
      }));
    }

    let hasFacebook = false;
    let facebookProfileUrl: string | null = null;
    let googleEmail: string | null = null;
    if (isElevated) {
      const oauthAccounts = await this.prisma.oauth_accounts.findMany({ where: { userId: id } });
      const fb = oauthAccounts.find((a) => a.provider === 'facebook');
      const gg = oauthAccounts.find((a) => a.provider === 'google');
      hasFacebook = !!fb;
      if (fb) facebookProfileUrl = fb.profileUrl ?? null;
      if (gg) googleEmail = gg.email;
    }

    const isAdmin = hasAdminRights(user.role);
    return {
      id: user.id,
      fullName: user.fullName,
      profilePhotoPath: user.profilePhotoPath,
      cityId: user.cityId,
      cityName: user.city?.name ?? null,
      joinedAt: user.createdAt,
      isAdmin,
      invitedBy: invitedByInfo,
      ...(isSelf || isElevated ? { invitedMembers } : {}),
      ...(isElevated ? {
        role: user.role,
        status: user.status,
        inviteSource: user.inviteSource,
        hasFacebook,
        facebookProfileUrl,
        googleEmail,
        // Drives the admin role-picker's "promote back" affordance. Reads the
        // column rather than the fixed email it used to compare against: the
        // role is deliberately mutable here (that is what the picker is for)
        // and the email is branding v2-9 rewrites.
        isAutomationAccount: user.isServiceAccount,
      } : {}),
    };
  }

  async validateMember(targetId: number): Promise<{ message: string }> {
    const user = await this.prisma.users.findUnique({ where: { id: targetId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== UserRole.NON_VALIDATED) {
      return { message: 'User is already validated' };
    }
    await this.prisma.users.update({ where: { id: targetId }, data: { role: UserRole.MEMBER } });
    return { message: 'Member validated successfully' };
  }

  // REQ-DEL-04 — soft-delete the calling user's own account
  async softDeleteSelf(user: User): Promise<void> {
    if (hasAdminRights(user.role)) {
      throw new ForbiddenException('Admin accounts cannot be self-deleted.');
    }
    // Reachable only on the root tenant, whose service account can hold a real
    // role and therefore a real session; elsewhere it is `disabled` and cannot
    // authenticate at all. Guarded anyway, because "the account that cannot be
    // deleted" should not have one route left that deletes it.
    assertNotServiceAccount(user, 'self-delete');

    const linkedProviders = await this.prisma.oauth_accounts.findMany({
      where: { userId: user.id },
    });
    const providerNames = linkedProviders.map((p) => p.provider);

    const hardDeleteAt = new Date();
    hardDeleteAt.setDate(hardDeleteAt.getDate() + 30);

    // Delete local photo from disk before nulling the path — the hard-delete cron
    // won't be able to find it once profilePhotoPath is cleared.
    if (user.profilePhotoPath?.startsWith('/api/v1/uploads/profiles/')) {
      const filename = user.profilePhotoPath.replace('/api/v1/uploads/profiles/', '');
      const uploadPath = process.env.UPLOAD_PATH ?? '/app/uploads';
      try {
        await unlink(join(uploadPath, 'profiles', filename));
      } catch {
        // Non-fatal — file may already be gone
      }
    }

    const tenantId = requireTenantId('account deletion');

    await this.prisma.$transaction(async (tx) => {
      await tx.users.update({
        where: { id: user.id },
        data: {
          status: UserStatus.DELETED,
          deletedAt: new Date(),
          hardDeleteAt,
          fullName: 'Deleted Member',
          email: `deleted-${user.id}@deleted.dinnerbears.com`,
          passwordHash: null,
          profilePhotoPath: null,
        },
      });
      await tx.oauth_accounts.deleteMany({ where: { userId: user.id } });
      await tx.login_sessions.deleteMany({ where: { userId: user.id } });
      await tx.push_subscriptions.deleteMany({ where: { userId: user.id } });
      // Cancel RSVPs on upcoming events. Kept as raw SQL: CURDATE() is
      // evaluated by the database, and expressing this as a nested relation
      // filter would need the cutoff computed in Node, which reintroduces the
      // server-vs-database clock difference the original avoided.
      // The tx.* calls above are scoped by the extension; these two are raw and
      // are not, so event_rsvps, invites and the events subquery each take an
      // explicit tenant_id.
      await tx.$executeRawUnsafe(
        `DELETE FROM event_rsvps WHERE user_id = ? AND tenant_id = ? AND event_id IN (SELECT id FROM events WHERE event_date >= CURDATE() AND tenant_id = ?)`,
        user.id,
        tenantId,
        tenantId,
      );
      // Revoke event invite links they created for upcoming events
      await tx.$executeRawUnsafe(
        `UPDATE invites SET is_revoked = 1 WHERE created_by = ? AND tenant_id = ? AND type = 'event_invite' AND event_id IN (SELECT id FROM events WHERE event_date >= CURDATE() AND tenant_id = ?)`,
        user.id,
        tenantId,
        tenantId,
      );
    });

    await this.auditService.log({
      userId: user.id,
      action: 'account_deleted',
      entityType: 'user',
      entityId: user.id,
      metadata: { providers: providerNames },
    });

    // Queue deletion email (before session is cleared by the controller)
    try {
      await this.emailService.queue({
        toEmail: user.email,
        toName: user.fullName,
        subject: 'Your {{brand}} account has been deactivated',
        templateId: EmailTemplate.ACCOUNT_DELETED,
        templateParams: { name: user.fullName },
        userId: user.id,
      });
    } catch {
      // Non-fatal
    }
  }
}

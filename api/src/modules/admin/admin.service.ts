import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity, UserRole, UserStatus } from '../../database/entities/user.entity';
import { OAuthAccountEntity } from '../../database/entities/oauth-account.entity';
import { AuditLogEntity } from '../../database/entities/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { SuppressionReason } from '../../database/entities/email-suppression.entity';

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
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(OAuthAccountEntity)
    private readonly oauthRepo: Repository<OAuthAccountEntity>,
    @InjectRepository(AuditLogEntity)
    private readonly auditRepo: Repository<AuditLogEntity>,
    private readonly auditService: AuditService,
    private readonly emailService: EmailService,
  ) {}

  async getUsers(): Promise<AdminUserRow[]> {
    const users = await this.userRepo
      .createQueryBuilder('u')
      .leftJoin(UserEntity, 'inviter', 'inviter.id = u.invited_by')
      .select([
        'u.id AS id',
        'u.full_name AS fullName',
        'u.email AS email',
        'u.role AS role',
        'u.status AS status',
        'u.email_status AS emailStatus',
        'u.city_id AS cityId',
        'u.profile_photo_path AS profilePhotoPath',
        'u.invited_by AS invitedById',
        'inviter.full_name AS invitedByName',
        'u.created_at AS createdAt',
        'u.last_login_at AS lastLoginAt',
        'u.login_count AS loginCount',
      ])
      .where('u.deleted_at IS NULL')
      .orderBy('u.created_at', 'DESC')
      .getRawMany<Omit<AdminUserRow, 'oauthProviders'>>();

    const oauthAccounts = await this.oauthRepo.find({
      select: ['userId', 'provider', 'providerId', 'email'],
    });

    const oauthByUser = new Map<number, Array<{ provider: string; providerId: string; email: string | null }>>();
    for (const acc of oauthAccounts) {
      const list = oauthByUser.get(acc.userId) ?? [];
      list.push({ provider: acc.provider, providerId: acc.providerId, email: acc.email });
      oauthByUser.set(acc.userId, list);
    }

    return users.map((u) => ({ ...u, oauthProviders: oauthByUser.get(u.id) ?? [] }));
  }

  async getAuditLog(filter: AuditLogFilter): Promise<{ data: AuditLogRow[]; total: number }> {
    const page = Math.max(1, filter.page ?? 1);
    const limit = Math.min(200, Math.max(1, filter.limit ?? 50));
    const skip = (page - 1) * limit;

    const buildBase = () => {
      const qb = this.auditRepo
        .createQueryBuilder('a')
        .leftJoin(UserEntity, 'u', 'u.id = a.user_id');
      if (filter.userId) qb.andWhere('a.user_id = :userId', { userId: filter.userId });
      if (filter.userSearch) qb.andWhere('(u.full_name LIKE :search OR u.email LIKE :search)', { search: `%${filter.userSearch}%` });
      if (filter.entityType) qb.andWhere('a.entity_type = :entityType', { entityType: filter.entityType });
      if (filter.action) qb.andWhere('a.action = :action', { action: filter.action });
      if (filter.dateFrom) qb.andWhere('a.created_at >= :dateFrom', { dateFrom: new Date(filter.dateFrom) });
      if (filter.dateTo) qb.andWhere('a.created_at <= :dateTo', { dateTo: new Date(filter.dateTo) });
      return qb;
    };

    const dataQb = buildBase()
      .select([
        'a.id AS id',
        'a.user_id AS userId',
        'u.full_name AS userName',
        'a.action AS action',
        'a.entity_type AS entityType',
        'a.entity_id AS entityId',
        'a.metadata AS metadata',
        'a.ip_address AS ipAddress',
        'a.created_at AS createdAt',
      ])
      .orderBy('a.created_at', 'DESC')
      .offset(skip)
      .limit(limit);

    const countQb = buildBase().select('COUNT(*) AS cnt');

    const [data, countResult] = await Promise.all([
      dataQb.getRawMany<AuditLogRow>(),
      countQb.getRawOne<{ cnt: string }>(),
    ]);

    return { data, total: parseInt(countResult?.cnt ?? '0', 10) };
  }

  async getInviteLineage(): Promise<object[]> {
    const users = await this.userRepo
      .createQueryBuilder('u')
      .select(['u.id AS id', 'u.full_name AS fullName', 'u.invited_by AS invitedBy', 'u.created_at AS joinedAt', 'u.role AS role', 'u.status AS status'])
      .where('u.deleted_at IS NULL')
      .getRawMany<{ id: number; fullName: string; invitedBy: number | null; joinedAt: Date; role: string; status: string }>();

    const byId = new Map(users.map((u) => [u.id, { ...u, invitedMembers: [] as object[] }]));

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
    const user = await this.userRepo.findOne({ where: { id: userId }, select: ['email'] });
    if (!user) return false;
    return this.emailService.isSuppressed(user.email);
  }

  async suppressUserEmail(userId: number, actorId: number): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    await this.emailService.suppress(user.email, SuppressionReason.UNSUBSCRIBED);
    await this.auditService.log({ userId: actorId, action: 'admin.suppress_email', entityType: 'user', entityId: userId });
  }

  async liftEmailSuppression(userId: number, actorId: number): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    await this.emailService.removeSuppression(user.email);
    await this.auditService.log({ userId: actorId, action: 'admin.lift_suppression', entityType: 'user', entityId: userId });
  }

  async banUser(targetId: number, actorId: number, actorRole: UserRole): Promise<void> {
    const target = await this.userRepo.findOne({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');
    if (target.id === actorId) throw new BadRequestException('Cannot ban yourself');
    if (target.role === UserRole.ADMIN) throw new ForbiddenException('Cannot ban an admin');
    if (actorRole === UserRole.MODERATOR && target.role !== UserRole.MEMBER) {
      throw new ForbiddenException('Moderators can only ban regular members');
    }
    if (target.status === UserStatus.SUSPENDED) throw new BadRequestException('User is already banned');
    await this.userRepo.update(targetId, { status: UserStatus.SUSPENDED });
    await this.auditService.log({ userId: actorId, action: 'user.ban', entityType: 'user', entityId: targetId });
  }

  async forceBanUser(targetId: number, actorId: number): Promise<void> {
    const target = await this.userRepo.findOne({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');
    if (target.id === actorId) throw new BadRequestException('Cannot ban yourself');
    if (target.role === UserRole.ADMIN) throw new ForbiddenException('Cannot ban an admin');
    await this.userRepo.update(targetId, {
      status: UserStatus.DELETED,
      deletedAt: new Date(),
    });
    await this.auditService.log({ userId: actorId, action: 'user.force_ban', entityType: 'user', entityId: targetId });
  }

  async unbanUser(targetId: number, actorId: number): Promise<void> {
    const target = await this.userRepo.findOne({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');
    if (target.status === UserStatus.ACTIVE) throw new BadRequestException('User is not banned');
    await this.userRepo.update(targetId, { status: UserStatus.ACTIVE, deletedAt: null });
    await this.auditService.log({ userId: actorId, action: 'user.unban', entityType: 'user', entityId: targetId });
  }

  async devDeleteUser(targetId: number, actorId: number): Promise<void> {
    const target = await this.userRepo.findOne({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');
    if (target.id === actorId) throw new BadRequestException('Cannot delete yourself');
    if (target.role === UserRole.ADMIN) throw new ForbiddenException('Cannot delete an admin');

    await this.oauthRepo.delete({ userId: targetId });

    await this.userRepo.update(targetId, {
      status: UserStatus.DELETED,
      deletedAt: new Date(),
      email: `deleted_${targetId}@deleted.invalid`,
    });
    await this.auditService.log({ userId: actorId, action: 'user.admin_delete', entityType: 'user', entityId: targetId });
  }

  async setRole(targetId: number, actorId: number, role: UserRole): Promise<void> {
    const target = await this.userRepo.findOne({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');
    if (target.id === actorId) throw new BadRequestException('Cannot change your own role');
    if (target.role === UserRole.ADMIN) throw new ForbiddenException('Cannot change another admin\'s role');
    // The dedicated automation account (see AddAutomationRole migration) is the
    // one exception — Rob can flip it up to admin via the UI to let it browse
    // role-gated pages for testing, then flip it back. Regular members still
    // require a direct DB edit to be promoted to admin.
    if (role === UserRole.ADMIN && target.role !== UserRole.AUTOMATION) {
      throw new ForbiddenException('Cannot promote to admin — set directly in the database');
    }
    const previousRole = target.role;
    await this.userRepo.update(targetId, { role });
    await this.auditService.log({
      userId: actorId,
      action: 'user.role_change',
      entityType: 'user',
      entityId: targetId,
      metadata: { from: previousRole, to: role },
    });
  }
}

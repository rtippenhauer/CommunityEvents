import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { DataSource, Not, Repository } from 'typeorm';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { UserEntity, UserRole, UserStatus, EmailStatus } from '../../database/entities/user.entity';
import { OAuthAccountEntity } from '../../database/entities/oauth-account.entity';
import { LoginSessionEntity } from '../../database/entities/login-session.entity';
import { PushSubscriptionEntity } from '../../database/entities/push-subscription.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { EmailTemplate } from '../email/email.constants';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(OAuthAccountEntity)
    private readonly oauthRepo: Repository<OAuthAccountEntity>,
    @InjectRepository(LoginSessionEntity)
    private readonly sessionRepo: Repository<LoginSessionEntity>,
    @InjectRepository(PushSubscriptionEntity)
    private readonly pushRepo: Repository<PushSubscriptionEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly emailService: EmailService,
  ) {}

  async findById(id: number): Promise<UserEntity> {
    const user = await this.userRepo.findOne({ where: { id }, relations: ['city'] });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(user: UserEntity, dto: UpdateProfileDto): Promise<UserEntity> {
    if (dto.fullName) user.fullName = dto.fullName;
    if (dto.cityId) user.cityId = dto.cityId;
    if (dto.profilePhotoPath === null) user.profilePhotoPath = null;
    return this.userRepo.save(user);
  }

  async updatePhotoPath(userId: number, path: string): Promise<void> {
    await this.userRepo.update(userId, { profilePhotoPath: path });
  }

  async setAvatar(userId: number, avatarPath: string): Promise<{ url: string }> {
    await this.userRepo.update(userId, { profilePhotoPath: avatarPath });
    return { url: avatarPath };
  }

  async updateEmailStatus(userId: number, status: EmailStatus): Promise<void> {
    await this.userRepo.update(userId, { emailStatus: status });
  }

  async findMembers(viewerRole: UserRole): Promise<object[]> {
    const isElevated = viewerRole === UserRole.ADMIN || viewerRole === UserRole.MODERATOR;

    const rows = await this.userRepo
      .createQueryBuilder('u')
      .leftJoin(UserEntity, 'inviter', 'inviter.id = u.invited_by')
      .leftJoin('u.city', 'city')
      .select([
        'u.id AS id',
        'u.full_name AS fullName',
        'u.profile_photo_path AS profilePhotoPath',
        'u.city_id AS cityId',
        'city.name AS cityName',
        'u.created_at AS joinedAt',
        'u.invited_by AS invitedById',
        'inviter.full_name AS invitedByName',
        'inviter.profile_photo_path AS invitedByPhoto',
        ...(isElevated ? ['u.role AS role', 'u.status AS status'] : []),
      ])
      .where(isElevated ? 'u.status != :deleted' : 'u.status = :active', {
        deleted: UserStatus.DELETED,
        active: UserStatus.ACTIVE,
      })
      .orderBy('u.full_name', 'ASC')
      .getRawMany();

    return rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      profilePhotoPath: r.profilePhotoPath,
      cityId: r.cityId,
      cityName: r.cityName ?? null,
      joinedAt: r.joinedAt,
      invitedBy: r.invitedById
        ? { id: r.invitedById, fullName: r.invitedByName, profilePhotoPath: r.invitedByPhoto }
        : null,
      ...(isElevated ? { role: r.role, status: r.status } : {}),
    }));
  }

  async findMemberProfile(
    id: number,
    viewerId: number,
    viewerRole: UserRole,
  ): Promise<object> {
    const user = await this.userRepo.findOne({ where: { id }, relations: ['city'] });
    if (!user || user.status === UserStatus.DELETED) throw new NotFoundException('Member not found');

    const isElevated = viewerRole === UserRole.ADMIN || viewerRole === UserRole.MODERATOR;
    const isSelf = viewerId === id;

    let invitedByInfo: { id: number; fullName: string; profilePhotoPath: string | null } | null = null;
    if (user.invitedBy) {
      const inviter = await this.userRepo.findOne({ where: { id: user.invitedBy } });
      if (inviter) {
        invitedByInfo = { id: inviter.id, fullName: inviter.fullName, profilePhotoPath: inviter.profilePhotoPath };
      }
    }

    let invitedMembers: Array<{ id: number; fullName: string; profilePhotoPath: string | null }> = [];
    if (isSelf || isElevated) {
      const members = await this.userRepo.find({
        where: { invitedBy: id, status: Not(UserStatus.DELETED) },
        select: ['id', 'fullName', 'profilePhotoPath'],
        order: { createdAt: 'ASC' },
      });
      invitedMembers = members.map((m) => ({
        id: m.id,
        fullName: m.fullName,
        profilePhotoPath: m.profilePhotoPath,
      }));
    }

    return {
      id: user.id,
      fullName: user.fullName,
      profilePhotoPath: user.profilePhotoPath,
      cityId: user.cityId,
      cityName: user.city?.name ?? null,
      joinedAt: user.createdAt,
      invitedBy: invitedByInfo,
      ...(isSelf || isElevated ? { invitedMembers } : {}),
      ...(isElevated ? {
        role: user.role,
        status: user.status,
        inviteSource: user.inviteSource,
      } : {}),
    };
  }

  async validateMember(targetId: number): Promise<{ message: string }> {
    const user = await this.userRepo.findOne({ where: { id: targetId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== UserRole.NON_VALIDATED) {
      return { message: 'User is already validated' };
    }
    await this.userRepo.update(targetId, { role: UserRole.MEMBER });
    return { message: 'Member validated successfully' };
  }

  // REQ-DEL-04 — soft-delete the calling user's own account
  async softDeleteSelf(user: UserEntity): Promise<void> {
    if (user.role === UserRole.ADMIN) {
      throw new ForbiddenException('Admin accounts cannot be self-deleted.');
    }

    const linkedProviders = await this.oauthRepo.find({ where: { userId: user.id } });
    const providerNames = linkedProviders.map((p) => p.provider);

    const hardDeleteAt = new Date();
    hardDeleteAt.setDate(hardDeleteAt.getDate() + 30);

    // Delete local photo from disk before nulling the path — the hard-delete cron
    // won't be able to find it once profilePhotoPath is cleared.
    if (user.profilePhotoPath?.startsWith('/api/uploads/')) {
      const filename = user.profilePhotoPath.replace('/api/uploads/', '');
      const uploadPath = process.env.UPLOAD_PATH ?? '/app/uploads';
      try {
        await unlink(join(uploadPath, filename));
      } catch {
        // Non-fatal — file may already be gone
      }
    }

    await this.dataSource.transaction(async (em) => {
      await em.update(UserEntity, user.id, {
        status: UserStatus.DELETED,
        deletedAt: new Date(),
        hardDeleteAt,
        fullName: 'Deleted Member',
        email: `deleted-${user.id}@deleted.dinnerbears.com`,
        passwordHash: null,
        profilePhotoPath: null,
      });
      await em.delete(OAuthAccountEntity, { userId: user.id });
      await em.delete(LoginSessionEntity, { userId: user.id });
      await em.delete(PushSubscriptionEntity, { userId: user.id });
      // Cancel RSVPs on upcoming events
      await em.query(
        `DELETE FROM event_rsvps WHERE user_id = ? AND event_id IN (SELECT id FROM events WHERE event_date >= CURDATE())`,
        [user.id],
      );
      // Revoke event invite links they created for upcoming events
      await em.query(
        `UPDATE invites SET is_revoked = 1 WHERE created_by = ? AND type = 'event_invite' AND event_id IN (SELECT id FROM events WHERE event_date >= CURDATE())`,
        [user.id],
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
        subject: 'Your DinnerBears account has been deactivated',
        templateId: EmailTemplate.ACCOUNT_DELETED,
        templateParams: { name: user.fullName },
        userId: user.id,
      });
    } catch {
      // Non-fatal
    }
  }
}

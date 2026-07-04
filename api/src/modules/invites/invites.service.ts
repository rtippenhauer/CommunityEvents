import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthFlowError } from '../../common/errors/auth-flow.error';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { InviteEntity, InviteFlavor, InviteType } from '../../database/entities/invite.entity';
import { UserEntity, UserStatus } from '../../database/entities/user.entity';
import { EventEntity } from '../../database/entities/event.entity';
import { CreateInviteDto } from './dto/create-invite.dto';
import { EmailService } from '../email/email.service';
import { EmailTemplate } from '../email/email.constants';
import { ConfigService } from '@nestjs/config';
import { computeRsvpCutoffAt } from '../../common/utils/rsvp-cutoff.util';

const EVENT_INVITE_MAX_USES = 10;

@Injectable()
export class InvitesService {
  constructor(
    @InjectRepository(InviteEntity)
    private readonly inviteRepo: Repository<InviteEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(EventEntity)
    private readonly eventRepo: Repository<EventEntity>,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
  ) {}

  async create(dto: CreateInviteDto, creator: UserEntity): Promise<InviteEntity> {
    if (dto.type === InviteType.MEMBER && !dto.boundToEmail) {
      throw new BadRequestException('Member invites require boundToEmail');
    }
    if (dto.type === InviteType.CAMPAIGN_FACEBOOK && !dto.facebookGroupId) {
      throw new BadRequestException('Campaign invites require facebookGroupId');
    }

    if (dto.type === InviteType.MEMBER && dto.boundToEmail) {
      const existingMember = await this.userRepo.findOne({
        where: { email: dto.boundToEmail.toLowerCase(), status: Not(UserStatus.DELETED) },
      });
      if (existingMember) {
        throw new BadRequestException('already_a_member');
      }

      const existing = await this.inviteRepo.findOne({
        where: {
          boundToEmail: dto.boundToEmail,
          type: InviteType.MEMBER,
          isRevoked: false,
          redeemedAt: undefined,
        },
      });
      if (existing && existing.expiresAt > new Date()) {
        throw new BadRequestException('invite_already_exists');
      }
    }

    const expiresAt = new Date();
    if (dto.type === InviteType.MEMBER) {
      expiresAt.setHours(expiresAt.getHours() + 48);
    } else if (dto.noExpiry) {
      expiresAt.setFullYear(2099);
    } else {
      expiresAt.setDate(expiresAt.getDate() + (dto.expiryDays ?? 30));
    }

    const invite = this.inviteRepo.create({
      token: randomBytes(32).toString('hex'),
      type: dto.type,
      createdBy: creator.id,
      cityId: dto.cityId ?? null,
      facebookGroupId: dto.facebookGroupId ?? null,
      boundToEmail: dto.boundToEmail ?? null,
      boundToName: dto.boundToName ?? null,
      expiresAt,
      maxUses: dto.type === InviteType.MEMBER ? 1 : (dto.maxUses ?? null),
    });

    const saved = await this.inviteRepo.save(invite);

    if (dto.type === InviteType.MEMBER && dto.boundToEmail) {
      const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
      const inviteUrl = `${appUrl}/login?token=${saved.token}`;
      const inviterName = creator.fullName || 'A DinnerBears member';

      await this.emailService.queue({
        toEmail: dto.boundToEmail,
        toName: dto.boundToName ?? undefined,
        subject: `${inviterName} invited you to DinnerBears!`,
        templateId: EmailTemplate.INVITE,
        templateParams: {
          inviter_name: inviterName,
          invite_url: inviteUrl,
          invitee_name: dto.boundToName ?? dto.boundToEmail,
        },
        htmlBody: `
          <h2>You're invited to DinnerBears!</h2>
          <p><strong>${inviterName}</strong> has invited you to join DinnerBears — a community of people who love good food and great company.</p>
          <p><a href="${inviteUrl}" style="background:#1e4d8c;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;margin:16px 0">Accept Invite</a></p>
          <p style="color:#888;font-size:0.85em">This link expires in 48 hours and can only be used by this email address.</p>
        `,
      });
    }

    return saved;
  }

  async validate(token: string, email?: string): Promise<InviteEntity> {
    const invite = await this.inviteRepo.findOne({ where: { token } });

    if (!invite) throw new NotFoundException('Invalid invite link');
    if (invite.isRevoked) throw new BadRequestException('This invite has been revoked');
    if (invite.expiresAt < new Date()) throw new BadRequestException('This invite has expired');
    if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
      throw new BadRequestException('This invite has already been used');
    }
    if (invite.boundToEmail && email && invite.boundToEmail !== email.toLowerCase()) {
      throw new AuthFlowError('invite_email_mismatch', invite.boundToEmail);
    }

    return invite;
  }

  async redeem(invite: InviteEntity, user: UserEntity): Promise<void> {
    invite.useCount += 1;
    if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
      invite.redeemedBy = user.id;
      invite.redeemedAt = new Date();
    }
    await this.inviteRepo.save(invite);
  }

  async revoke(id: number): Promise<void> {
    await this.inviteRepo.update(id, { isRevoked: true });
  }

  async revokeOwn(id: number, userId: number): Promise<void> {
    const invite = await this.inviteRepo.findOne({ where: { id } });
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.createdBy !== userId) throw new ForbiddenException('Not your invite');
    if (invite.redeemedAt) throw new BadRequestException('Invite has already been accepted');
    await this.inviteRepo.update(id, { isRevoked: true });
  }

  findAll(): Promise<InviteEntity[]> {
    return this.inviteRepo.find({ order: { createdAt: 'DESC' } });
  }

  findByCreator(userId: number): Promise<InviteEntity[]> {
    return this.inviteRepo.find({
      where: { createdBy: userId },
      order: { createdAt: 'DESC' },
    });
  }

  async createEventInvite(
    eventId: number,
    flavor: InviteFlavor,
    creator: UserEntity,
  ): Promise<InviteEntity> {
    const event = await this.eventRepo.findOne({ where: { id: eventId } });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);

    const invite = this.inviteRepo.create({
      token: randomBytes(32).toString('hex'),
      type: InviteType.EVENT_INVITE,
      createdBy: creator.id,
      eventId,
      inviteFlavor: flavor,
      expiresAt: computeRsvpCutoffAt(event.eventDate, event.eventTime),
      maxUses: EVENT_INVITE_MAX_USES,
    });

    return this.inviteRepo.save(invite);
  }

  findByEvent(eventId: number): Promise<InviteEntity[]> {
    return this.inviteRepo.find({
      where: { eventId, type: InviteType.EVENT_INVITE },
      relations: ['creator'],
      order: { createdAt: 'DESC' },
    });
  }

  async findByToken(token: string): Promise<InviteEntity | null> {
    return this.inviteRepo.findOne({
      where: { token },
      relations: ['event', 'event.restaurant', 'event.restaurant.photos'],
    });
  }
}

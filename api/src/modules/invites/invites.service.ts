import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { InviteEntity, InviteType } from '../../database/entities/invite.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { CreateInviteDto } from './dto/create-invite.dto';

@Injectable()
export class InvitesService {
  constructor(
    @InjectRepository(InviteEntity)
    private readonly inviteRepo: Repository<InviteEntity>,
  ) {}

  async create(dto: CreateInviteDto, creator: UserEntity): Promise<InviteEntity> {
    if (dto.type === InviteType.MEMBER && !dto.boundToEmail) {
      throw new BadRequestException('Member invites require boundToEmail');
    }
    if (dto.type === InviteType.CAMPAIGN_FACEBOOK && !dto.facebookGroupId) {
      throw new BadRequestException('Campaign invites require facebookGroupId');
    }

    if (dto.type === InviteType.MEMBER && dto.boundToEmail) {
      const existing = await this.inviteRepo.findOne({
        where: {
          boundToEmail: dto.boundToEmail,
          type: InviteType.MEMBER,
          isRevoked: false,
          redeemedAt: undefined,
        },
      });
      if (existing && existing.expiresAt > new Date()) {
        throw new BadRequestException('An active invite already exists for this email');
      }
    }

    const expiresAt = new Date();
    if (dto.type === InviteType.MEMBER) {
      expiresAt.setHours(expiresAt.getHours() + 48);
    } else {
      expiresAt.setDate(expiresAt.getDate() + 30);
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
      maxUses: dto.type === InviteType.MEMBER ? 1 : null,
    });

    return this.inviteRepo.save(invite);
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
      throw new BadRequestException('This invite is for a different email address');
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

  findAll(): Promise<InviteEntity[]> {
    return this.inviteRepo.find({ order: { createdAt: 'DESC' } });
  }

  findByCreator(userId: number): Promise<InviteEntity[]> {
    return this.inviteRepo.find({
      where: { createdBy: userId },
      order: { createdAt: 'DESC' },
    });
  }
}

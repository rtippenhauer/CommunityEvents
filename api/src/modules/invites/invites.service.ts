import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthFlowError } from '../../common/errors/auth-flow.error';
import { randomBytes } from 'crypto';
import type { Prisma, invites as Invite, users as User } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { InviteFlavor, InviteType, UserStatus } from '../../database/enums';
import { CreateInviteDto } from './dto/create-invite.dto';
import { EmailService } from '../email/email.service';
import { EmailTemplate } from '../email/email.constants';
import { AppConfigService } from '../app-config/app-config.service';
import { ConfigService } from '@nestjs/config';
import { computeRsvpCutoffAt } from '../../common/utils/rsvp-cutoff.util';
import { toDateString, toTimeString } from '../../common/utils/prisma-date.util';
import { toPublicUser } from '../../common/utils/public-user.util';
import { TenantResolutionService } from '../../common/tenant/tenant-resolution.service';

const EVENT_INVITE_MAX_USES = 10;

// The event shape findByToken attaches, spelled out so callers keep the same
// typed access to location/photos they had through the entity relation.
type EventForInvite = Prisma.eventsGetPayload<{
  include: { location: { include: { photos: true } } };
}>;

@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
    private readonly appConfig: AppConfigService,
    private readonly tenantResolution: TenantResolutionService,
  ) {}

  async create(dto: CreateInviteDto, creator: User): Promise<Invite> {
    if (dto.type === InviteType.MEMBER && !dto.boundToEmail) {
      throw new BadRequestException('Member invites require boundToEmail');
    }
    if (dto.type === InviteType.CAMPAIGN_FACEBOOK && !dto.facebookGroupId) {
      throw new BadRequestException('Campaign invites require facebookGroupId');
    }

    if (dto.type === InviteType.MEMBER && dto.boundToEmail) {
      const existingMember = await this.prisma.users.findFirst({
        where: { email: dto.boundToEmail.toLowerCase(), status: { not: UserStatus.DELETED } },
      });
      if (existingMember) {
        throw new BadRequestException('already_a_member');
      }

      // redeemedAt: undefined is carried over verbatim -- in TypeORM that
      // meant "do not filter on this column", not "is null", and Prisma reads
      // undefined the same way. Changing it to null here would narrow the
      // duplicate check and is a behaviour change, not a translation.
      const existing = await this.prisma.invites.findFirst({
        where: {
          boundToEmail: dto.boundToEmail.toLowerCase(),
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

    const saved = await this.prisma.invites.create({
      data: {
        token: randomBytes(32).toString('hex'),
        type: dto.type,
        createdBy: creator.id,
        cityId: dto.cityId ?? null,
        facebookGroupId: dto.facebookGroupId ?? null,
        boundToEmail: dto.boundToEmail ? dto.boundToEmail.toLowerCase() : null,
        boundToName: dto.boundToName ?? null,
        expiresAt,
        maxUses: dto.type === InviteType.MEMBER ? 1 : (dto.maxUses ?? null),
      },
    });

    if (dto.type === InviteType.MEMBER && dto.boundToEmail) {
      // The invite's own tenant. `invites` is scoped, so a link to another
      // community's host cannot find the token and the invite reads as invalid.
      const appUrl = await this.tenantResolution.baseUrlFor(saved.tenantId);
      const brandName = await this.appConfig.getSiteSetting('brand_name');
      // The line under the invitation is the community's own tagline, the one
      // it edits in Site Settings. It used to be a hardcoded "people who love
      // good food and great company" — true of DinnerBears, an assertion about
      // a stranger's community anywhere else.
      const tagline = (await this.appConfig.getSiteSetting('brand_tagline')).trim();
      // The button used to be a hardcoded #1e4d8c, a blue belonging to no
      // community at all (v2-10).
      const primary = await this.appConfig.getSiteSetting('theme_color_primary');
      const inviteUrl = `${appUrl}/login?token=${saved.token}`;
      const inviterName = creator.fullName || `A ${brandName} member`;

      await this.emailService.queue({
        toEmail: dto.boundToEmail,
        toName: dto.boundToName ?? undefined,
        subject: `${inviterName} invited you to ${brandName}!`,
        templateId: EmailTemplate.INVITE,
        templateParams: {
          inviter_name: inviterName,
          invite_url: inviteUrl,
          invitee_name: dto.boundToName ?? dto.boundToEmail,
          brand_name: brandName,
          brand_tagline: tagline,
        },
        htmlBody: `
          <h2>You're invited to ${brandName}!</h2>
          <p><strong>${inviterName}</strong> has invited you to join ${brandName}.</p>
          ${tagline ? `<p style="color:#666">${tagline}</p>` : ''}
          <p><a href="${inviteUrl}" style="background:${primary};color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;margin:16px 0">Accept Invite</a></p>
          <p style="color:#888;font-size:0.85em">This link expires in 48 hours and can only be used by this email address.</p>
        `,
      });
    }

    return saved;
  }

  async validate(token: string, email?: string): Promise<Invite> {
    const invite = await this.prisma.invites.findUnique({ where: { token } });

    if (!invite) throw new NotFoundException('Invalid invite link');
    if (invite.isRevoked) throw new BadRequestException('This invite has been revoked');
    if (invite.expiresAt < new Date()) throw new BadRequestException('This invite has expired');
    if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
      throw new BadRequestException('This invite has already been used');
    }
    if (invite.boundToEmail && email && invite.boundToEmail.toLowerCase() !== email.toLowerCase()) {
      throw new AuthFlowError('invite_email_mismatch', invite.boundToEmail);
    }

    return invite;
  }

  async redeem(invite: Invite, user: User): Promise<void> {
    // The new count is computed from the row that was read, matching the
    // entity version exactly. Worth noting it carries the same read-modify-
    // write race it always had: two redemptions loading the same invite can
    // both write useCount + 1. An atomic { increment: 1 } would close that,
    // but the redeemedAt branch below depends on the resulting value, so
    // fixing it properly is a behaviour change and belongs with tests.
    const useCount = invite.useCount + 1;
    const exhausted = invite.maxUses !== null && useCount >= invite.maxUses;

    await this.prisma.invites.update({
      where: { id: invite.id },
      data: {
        useCount,
        ...(exhausted ? { redeemedBy: user.id, redeemedAt: new Date() } : {}),
      },
    });
  }

  async revoke(id: number): Promise<void> {
    await this.prisma.invites.update({ where: { id }, data: { isRevoked: true } });
  }

  async revokeOwn(id: number, userId: number): Promise<void> {
    const invite = await this.prisma.invites.findUnique({ where: { id } });
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.createdBy !== userId) throw new ForbiddenException('Not your invite');
    if (invite.redeemedAt) throw new BadRequestException('Invite has already been accepted');
    await this.prisma.invites.update({ where: { id }, data: { isRevoked: true } });
  }

  findAll(): Promise<Invite[]> {
    return this.prisma.invites.findMany({ orderBy: { createdAt: 'desc' } });
  }

  findByCreator(userId: number): Promise<Invite[]> {
    return this.prisma.invites.findMany({
      where: { createdBy: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createEventInvite(
    eventId: number,
    flavor: InviteFlavor,
    creator: User,
  ): Promise<Invite> {
    const event = await this.prisma.events.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);

    return this.prisma.invites.create({
      data: {
        token: randomBytes(32).toString('hex'),
        type: InviteType.EVENT_INVITE,
        createdBy: creator.id,
        eventId,
        inviteFlavor: flavor,
        // event_date/event_time are DATE/TIME columns the entity typed as
        // strings; Prisma returns Dates, so they are formatted back before
        // reaching the cutoff helper, which parses them as wall-clock strings.
        expiresAt: computeRsvpCutoffAt(
          toDateString(event.eventDate),
          toTimeString(event.eventTime),
        ),
        maxUses: EVENT_INVITE_MAX_USES,
      },
    });
  }

  async findByEvent(eventId: number): Promise<Invite[]> {
    const invites = await this.prisma.invites.findMany({
      where: { eventId, type: InviteType.EVENT_INVITE },
      include: { creator: true },
      orderBy: { createdAt: 'desc' },
    });
    return invites.map((i) => Object.assign(i, { creator: toPublicUser(i.creator) }));
  }

  async findByToken(token: string): Promise<(Invite & { event: EventForInvite | null }) | null> {
    const invite = await this.prisma.invites.findUnique({ where: { token } });
    if (!invite) return null;

    // invites.event_id has no foreign key in the database, so introspection
    // produced no relation to include -- the TypeORM entity declared a
    // @ManyToOne that the schema never actually enforced. The event is
    // therefore fetched separately and attached under the same key, so the
    // response shape is unchanged.
    if (invite.eventId === null) return Object.assign(invite, { event: null });

    const event = await this.prisma.events.findUnique({
      where: { id: invite.eventId },
      include: {
        // Keep photos[0] ("the cover photo") consistent with
        // events.service.ts's ordering.
        location: { include: { photos: { orderBy: { id: 'asc' } } } },
      },
    });
    return Object.assign(invite, { event });
  }
}

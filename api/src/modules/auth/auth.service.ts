import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import * as geoip from 'geoip-lite';
import { UserEntity, EmailStatus, InviteSource, UserRole, UserStatus } from '../../database/entities/user.entity';
import { OAuthAccountEntity, OAuthProvider } from '../../database/entities/oauth-account.entity';
import { LoginSessionEntity } from '../../database/entities/login-session.entity';
import { InvitesService } from '../invites/invites.service';
import { CitiesService } from '../cities/cities.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InviteType } from '../../database/entities/invite.entity';

export interface SessionContext {
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(OAuthAccountEntity)
    private readonly oauthRepo: Repository<OAuthAccountEntity>,
    @InjectRepository(LoginSessionEntity)
    private readonly sessionRepo: Repository<LoginSessionEntity>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly invitesService: InvitesService,
    private readonly citiesService: CitiesService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async findOrCreateGoogleUser(
    googleId: string,
    email: string,
    displayName: string,
    inviteToken?: string,
  ): Promise<UserEntity> {
    // Primary lookup: existing OAuth account
    const existing = await this.oauthRepo.findOne({
      where: { provider: OAuthProvider.GOOGLE, providerId: googleId },
      relations: ['user'],
    });
    if (existing) {
      if (existing.user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException('Account not active');
      }
      return existing.user;
    }

    // Fallback: user row exists (orphaned from a previous partial attempt)
    // Link the OAuth account and return rather than trying to re-insert.
    const existingByEmail = await this.userRepo.findOne({
      where: { email: email.toLowerCase() },
    });
    if (existingByEmail) {
      await this.oauthRepo.save(
        this.oauthRepo.create({
          userId: existingByEmail.id,
          provider: OAuthProvider.GOOGLE,
          providerId: googleId,
          email: email.toLowerCase(),
        }),
      );
      return existingByEmail;
    }

    const adminEmail = this.configService.get<string>('ADMIN_EMAIL');
    const isAdminBootstrap =
      !!adminEmail && email.toLowerCase() === adminEmail.toLowerCase();

    if (!inviteToken && !isAdminBootstrap) {
      throw new UnauthorizedException('An invite is required to create an account');
    }

    const invite = inviteToken
      ? await this.invitesService.validate(inviteToken, email)
      : null;

    const defaultCity = await this.citiesService.findAll().then((cities) => cities[0]);

    const user = this.userRepo.create({
      fullName: displayName,
      email: email.toLowerCase(),
      emailStatus: EmailStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      cityId: defaultCity.id,
      role: isAdminBootstrap ? UserRole.ADMIN : UserRole.MEMBER,
      inviteId: invite?.id ?? null,
      invitedBy: invite?.createdBy ?? null,
      inviteSource: invite
        ? invite.type === InviteType.CAMPAIGN_FACEBOOK
          ? InviteSource.FACEBOOK_GROUP
          : InviteSource.GOOGLE_OAUTH
        : null,
    });
    await this.userRepo.save(user);

    await this.oauthRepo.save(
      this.oauthRepo.create({
        userId: user.id,
        provider: OAuthProvider.GOOGLE,
        providerId: googleId,
        email: email.toLowerCase(),
      }),
    );

    if (invite) {
      await this.invitesService.redeem(invite, user);
    }

    await this.auditService.log({
      userId: user.id,
      action: 'user.register',
      entityType: 'user',
      entityId: user.id,
      metadata: {
        provider: 'google',
        inviteType: invite?.type ?? 'admin_bootstrap',
      },
    });

    return user;
  }

  async issueTokens(
    user: UserEntity,
    ctx: SessionContext,
  ): Promise<{ accessToken: string; jti: string }> {
    const jti = randomUUID();
    const accessToken = this.jwtService.sign({ sub: user.id, jti });

    const geo = ctx.ipAddress ? geoip.lookup(ctx.ipAddress) : null;

    const session = this.sessionRepo.create({
      userId: user.id,
      jwtJti: jti,
      userAgent: ctx.userAgent ?? null,
      ipAddress: ctx.ipAddress ?? null,
      country: geo?.country ?? null,
      city: geo?.city ?? null,
    });
    await this.sessionRepo.save(session);

    const previousSession = await this.sessionRepo.findOne({
      where: { userId: user.id, userAgent: ctx.userAgent ?? undefined, isActive: true },
    });
    const isNewDevice = !previousSession || previousSession.id === session.id;
    if (isNewDevice) {
      const location = [geo?.city, geo?.country].filter(Boolean).join(', ') || 'unknown location';
      await this.notificationsService.create({
        userId: user.id,
        type: 'security_alert',
        title: 'New sign-in detected',
        body: `A new sign-in was detected from ${location}.`,
        actionUrl: '/profile',
      });
    }

    await this.userRepo.update(user.id, {
      lastLoginAt: new Date(),
      loginCount: () => 'login_count + 1',
    });

    await this.auditService.log({
      userId: user.id,
      action: 'user.login',
      entityType: 'user',
      entityId: user.id,
      ipAddress: ctx.ipAddress,
    });

    return { accessToken, jti };
  }

  async logout(jti: string, userId: number): Promise<void> {
    await this.sessionRepo.update({ jwtJti: jti }, { isActive: false });
    await this.auditService.log({ userId, action: 'user.logout' });
  }

  me(user: UserEntity): Partial<UserEntity> {
    const { passwordHash: _pw, ...safe } = user as UserEntity & { passwordHash: unknown };
    void _pw;
    return safe;
  }
}

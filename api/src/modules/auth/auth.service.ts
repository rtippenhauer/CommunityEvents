import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AuthFlowError } from '../../common/errors/auth-flow.error';
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
        throw new AuthFlowError('not_active');
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
      throw new AuthFlowError('no_invite');
    }

    let invite = null;
    if (inviteToken) {
      try {
        invite = await this.invitesService.validate(inviteToken, email);
      } catch (err) {
        if (err instanceof AuthFlowError) throw err; // already has reason + boundEmail
        if (err instanceof NotFoundException) throw new AuthFlowError('invalid_invite');
        const msg: string = (err as Error).message ?? '';
        if (msg.includes('expired')) throw new AuthFlowError('invite_expired');
        if (msg.includes('already been used') || msg.includes('revoked')) throw new AuthFlowError('invite_used');
        throw new AuthFlowError('invalid_invite');
      }
    }

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

  async findOrCreateFacebookUser(
    facebookId: string,
    email: string | null,
    displayName: string,
    inviteToken?: string,
  ): Promise<UserEntity> {
    // Primary lookup: existing Facebook OAuth account
    const existing = await this.oauthRepo.findOne({
      where: { provider: OAuthProvider.FACEBOOK, providerId: facebookId },
      relations: ['user'],
    });
    if (existing) {
      if (existing.user.status !== UserStatus.ACTIVE) throw new AuthFlowError('not_active');
      return existing.user;
    }

    // Email match: link Facebook to existing account
    if (email) {
      const existingByEmail = await this.userRepo.findOne({
        where: { email: email.toLowerCase() },
      });
      if (existingByEmail) {
        if (existingByEmail.status !== UserStatus.ACTIVE) throw new AuthFlowError('not_active');
        await this.oauthRepo.save(
          this.oauthRepo.create({
            userId: existingByEmail.id,
            provider: OAuthProvider.FACEBOOK,
            providerId: facebookId,
            email: email.toLowerCase(),
          }),
        );
        return existingByEmail;
      }
    }

    // New user — requires invite
    if (!inviteToken) throw new AuthFlowError('no_invite');

    let invite = null;
    try {
      invite = await this.invitesService.validate(inviteToken, email ?? '');
    } catch (err) {
      if (err instanceof AuthFlowError) throw err;
      if (err instanceof NotFoundException) throw new AuthFlowError('invalid_invite');
      const msg: string = (err as Error).message ?? '';
      if (msg.includes('expired')) throw new AuthFlowError('invite_expired');
      if (msg.includes('already been used') || msg.includes('revoked')) throw new AuthFlowError('invite_used');
      throw new AuthFlowError('invalid_invite');
    }

    const defaultCity = await this.citiesService.findAll().then((cities) => cities[0]);

    const user = this.userRepo.create({
      fullName: displayName,
      email: email ? email.toLowerCase() : `fb_${facebookId}@placeholder.invalid`,
      emailStatus: email ? EmailStatus.ACTIVE : EmailStatus.PENDING,
      emailVerifiedAt: email ? new Date() : undefined,
      cityId: defaultCity.id,
      role: UserRole.MEMBER,
      inviteId: invite?.id ?? null,
      invitedBy: invite?.createdBy ?? null,
      inviteSource: InviteSource.GOOGLE_OAUTH,
    });
    await this.userRepo.save(user);

    await this.oauthRepo.save(
      this.oauthRepo.create({
        userId: user.id,
        provider: OAuthProvider.FACEBOOK,
        providerId: facebookId,
        email: email ? email.toLowerCase() : null,
      }),
    );

    if (invite) await this.invitesService.redeem(invite, user);

    await this.auditService.log({
      userId: user.id,
      action: 'user.register',
      entityType: 'user',
      entityId: user.id,
      metadata: { provider: 'facebook', inviteType: invite?.type ?? 'none' },
    });

    return user;
  }

  async linkFacebook(
    userId: number,
    facebookId: string,
    email: string | null,
  ): Promise<void> {
    // Reject if this FB account is already linked to any user
    const alreadyLinked = await this.oauthRepo.findOne({
      where: { provider: OAuthProvider.FACEBOOK, providerId: facebookId },
    });
    if (alreadyLinked) {
      if (alreadyLinked.userId === userId) return; // already linked to self — no-op
      throw new ConflictException('This Facebook account is already linked to another user');
    }

    await this.oauthRepo.save(
      this.oauthRepo.create({
        userId,
        provider: OAuthProvider.FACEBOOK,
        providerId: facebookId,
        email: email ? email.toLowerCase() : null,
      }),
    );

    await this.auditService.log({
      userId,
      action: 'user.link_facebook',
      entityType: 'user',
      entityId: userId,
    });
  }

  async handleFacebookDeletion(facebookUserId: string): Promise<string> {
    const account = await this.oauthRepo.findOne({
      where: { provider: OAuthProvider.FACEBOOK, providerId: facebookUserId },
    });
    if (account) {
      await this.auditService.log({
        userId: account.userId,
        action: 'user.facebook_data_deletion',
        entityType: 'user',
        entityId: account.userId,
      });
      await this.oauthRepo.remove(account);
    }
    // Return a confirmation code — first 12 chars of a UUID
    return randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
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

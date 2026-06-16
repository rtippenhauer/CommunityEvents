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
import { FacebookDeletionRequestEntity, FacebookDeletionStatus } from '../../database/entities/facebook-deletion-request.entity';
import { InvitesService } from '../invites/invites.service';
import { CitiesService } from '../cities/cities.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';
import { EmailTemplate } from '../email/email.constants';
import { InviteFlavor, InviteType } from '../../database/entities/invite.entity';

export interface SessionContext {
  userAgent?: string;
  ipAddress?: string;
}

const FB_CDN_HOSTS = ['fbcdn.net', 'graph.facebook.com', 'facebook.com'];
const GOOGLE_CDN_HOSTS = ['googleusercontent.com'];

function isCdnPhoto(path: string | null, hosts: string[]): boolean {
  if (!path) return false;
  try {
    const url = new URL(path);
    return hosts.some((h) => url.hostname.endsWith(h));
  } catch {
    return false;
  }
}

@Injectable()
export class AuthService {
  private readonly frontendUrl: string;

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(OAuthAccountEntity)
    private readonly oauthRepo: Repository<OAuthAccountEntity>,
    @InjectRepository(LoginSessionEntity)
    private readonly sessionRepo: Repository<LoginSessionEntity>,
    @InjectRepository(FacebookDeletionRequestEntity)
    private readonly fbDeletionRepo: Repository<FacebookDeletionRequestEntity>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly invitesService: InvitesService,
    private readonly citiesService: CitiesService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
  ) {
    this.frontendUrl = this.configService.get<string>('APP_URL', 'http://localhost:8081');
  }

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
      if (existing.user.status === UserStatus.SUSPENDED || existing.user.status === UserStatus.DELETED) {
        throw new AuthFlowError('not_active');
      }
      return existing.user;
    }

    // Fallback: user row exists (orphaned from a previous partial attempt)
    const existingByEmail = await this.userRepo.findOne({
      where: { email: email.toLowerCase() },
    });
    if (existingByEmail) {
      if (existingByEmail.status === UserStatus.DELETED) {
        throw new AuthFlowError('not_active');
      }
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
        if (err instanceof AuthFlowError) throw err;
        if (err instanceof NotFoundException) throw new AuthFlowError('invalid_invite');
        const msg: string = (err as Error).message ?? '';
        if (msg.includes('expired')) throw new AuthFlowError('invite_expired');
        if (msg.includes('already been used') || msg.includes('revoked')) throw new AuthFlowError('invite_used');
        throw new AuthFlowError('invalid_invite');
      }
    }

    const defaultCity = await this.citiesService.findAll().then((cities) => cities[0]);

    const isEventInvite = invite?.type === InviteType.EVENT_INVITE;
    const isNonValidatedInvite = isEventInvite && invite?.inviteFlavor === InviteFlavor.NON_VALIDATED;

    const user = this.userRepo.create({
      fullName: displayName,
      email: email.toLowerCase(),
      emailStatus: EmailStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      cityId: defaultCity.id,
      role: isAdminBootstrap ? UserRole.ADMIN : (isNonValidatedInvite ? UserRole.NON_VALIDATED : UserRole.MEMBER),
      status: UserStatus.ACTIVE,
      inviteId: invite?.id ?? null,
      invitedBy: invite?.createdBy ?? null,
      inviteSource: invite
        ? invite.type === InviteType.CAMPAIGN_FACEBOOK
          ? InviteSource.FACEBOOK_GROUP
          : isNonValidatedInvite
            ? InviteSource.NON_VALIDATED_LINK
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
    const existing = await this.oauthRepo.findOne({
      where: { provider: OAuthProvider.FACEBOOK, providerId: facebookId },
      relations: ['user'],
    });
    if (existing) {
      if (existing.user.status === UserStatus.SUSPENDED || existing.user.status === UserStatus.DELETED) {
        throw new AuthFlowError('not_active');
      }
      return existing.user;
    }

    if (email) {
      const existingByEmail = await this.userRepo.findOne({
        where: { email: email.toLowerCase() },
      });
      if (existingByEmail) {
        if (existingByEmail.status === UserStatus.SUSPENDED || existingByEmail.status === UserStatus.DELETED) {
          throw new AuthFlowError('not_active');
        }
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

    const isFbEventInvite = invite?.type === InviteType.EVENT_INVITE;
    const isFbNonValidated = isFbEventInvite && invite?.inviteFlavor === InviteFlavor.NON_VALIDATED;

    const user = this.userRepo.create({
      fullName: displayName,
      email: email ? email.toLowerCase() : `fb_${facebookId}@placeholder.invalid`,
      emailStatus: email ? EmailStatus.ACTIVE : EmailStatus.PENDING,
      emailVerifiedAt: email ? new Date() : undefined,
      cityId: defaultCity.id,
      role: isFbNonValidated ? UserRole.NON_VALIDATED : UserRole.MEMBER,
      status: UserStatus.ACTIVE,
      inviteId: invite?.id ?? null,
      invitedBy: invite?.createdBy ?? null,
      inviteSource: invite?.type === InviteType.CAMPAIGN_FACEBOOK
        ? InviteSource.FACEBOOK_GROUP
        : isFbNonValidated
          ? InviteSource.NON_VALIDATED_LINK
          : InviteSource.GOOGLE_OAUTH,
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
    const alreadyLinked = await this.oauthRepo.findOne({
      where: { provider: OAuthProvider.FACEBOOK, providerId: facebookId },
    });
    if (alreadyLinked) {
      if (alreadyLinked.userId === userId) return;
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

  // --- Connected Accounts ---

  async getConnectedProviders(userId: number): Promise<{
    google: { email: string | null } | null;
    facebook: { email: string | null } | null;
    hasMultipleMethods: boolean;
  }> {
    const accounts = await this.oauthRepo.find({ where: { userId } });
    const google = accounts.find((a) => a.provider === OAuthProvider.GOOGLE) ?? null;
    const facebook = accounts.find((a) => a.provider === OAuthProvider.FACEBOOK) ?? null;
    const count = accounts.length;
    return {
      google: google ? { email: google.email } : null,
      facebook: facebook ? { email: facebook.email } : null,
      hasMultipleMethods: count > 1,
    };
  }

  async disconnectProvider(userId: number, provider: OAuthProvider): Promise<void> {
    const user = await this.userRepo.findOneOrFail({ where: { id: userId } });
    const accounts = await this.oauthRepo.find({ where: { userId } });
    const target = accounts.find((a) => a.provider === provider);

    if (!target) throw new NotFoundException(`${provider} is not linked to your account`);

    if (accounts.length <= 1) {
      // Only auth method — cannot disconnect
      throw new ConflictException('ONLY_AUTH_METHOD');
    }

    // Clear CDN photo if it belongs to this provider
    if (provider === OAuthProvider.FACEBOOK && isCdnPhoto(user.profilePhotoPath, FB_CDN_HOSTS)) {
      await this.userRepo.update(userId, { profilePhotoPath: null });
    } else if (provider === OAuthProvider.GOOGLE && isCdnPhoto(user.profilePhotoPath, GOOGLE_CDN_HOSTS)) {
      await this.userRepo.update(userId, { profilePhotoPath: null });
    }

    await this.oauthRepo.remove(target);

    await this.auditService.log({
      userId,
      action: `${provider}_disconnected`,
      entityType: 'user',
      entityId: userId,
    });

    // Queue confirmation email (best-effort)
    const providerLabel = provider === OAuthProvider.GOOGLE ? 'Google' : 'Facebook';
    await this.emailService.queue({
      toEmail: user.email,
      toName: user.fullName,
      subject: `${providerLabel} login removed from DinnerBears`,
      templateId: EmailTemplate.PROVIDER_DISCONNECTED,
      templateParams: { provider: providerLabel, name: user.fullName },
      userId,
    });
  }

  // --- Facebook Deletion Callback ---

  async handleFacebookDeletion(facebookUserId: string): Promise<string> {
    const confirmationCode = randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase();

    const account = await this.oauthRepo.findOne({
      where: { provider: OAuthProvider.FACEBOOK, providerId: facebookUserId },
    });

    let dinnerbearsUserId: number | null = null;

    if (account) {
      dinnerbearsUserId = account.userId;
      const allAccounts = await this.oauthRepo.find({ where: { userId: account.userId } });

      if (allAccounts.length > 1) {
        // User has other auth methods — just delete the FB OAuth row
        await this.oauthRepo.remove(account);
        await this.auditService.log({
          userId: account.userId,
          action: 'facebook_disconnected_by_meta_callback',
          entityType: 'user',
          entityId: account.userId,
        });
      } else {
        // Facebook was the only auth method — full soft-delete
        const user = await this.userRepo.findOne({ where: { id: account.userId } });
        if (user && user.status !== UserStatus.DELETED) {
          const hardDeleteAt = new Date();
          hardDeleteAt.setDate(hardDeleteAt.getDate() + 30);

          await this.userRepo.update(user.id, {
            status: UserStatus.DELETED,
            deletedAt: new Date(),
            hardDeleteAt,
            passwordHash: null,
            profilePhotoPath: null,
          });
          await this.oauthRepo.delete({ userId: user.id });

          await this.auditService.log({
            userId: user.id,
            action: 'account_deleted_by_meta_callback',
            entityType: 'user',
            entityId: user.id,
          });

          // Attempt confirmation email — don't fail the callback if this errors
          if (!user.email.endsWith('@placeholder.invalid')) {
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
      }
    }

    // Always persist a deletion request record
    await this.fbDeletionRepo.save(
      this.fbDeletionRepo.create({
        facebookUserId,
        confirmationCode,
        dinnerbearsUserId,
        status: FacebookDeletionStatus.PENDING,
      }),
    );

    return confirmationCode;
  }

  async getFacebookDeletionStatus(code: string): Promise<{ status: 'pending' | 'completed' | 'not_found' }> {
    const record = await this.fbDeletionRepo.findOne({ where: { confirmationCode: code } });
    if (!record) return { status: 'not_found' };
    return { status: record.status };
  }

  // --- Sessions ---

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

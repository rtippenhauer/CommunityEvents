import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AuthFlowError } from '../../common/errors/auth-flow.error';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
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

  private async releaseDeletedEmail(email: string): Promise<void> {
    const deleted = await this.userRepo.findOne({
      where: { email, status: UserStatus.DELETED },
    });
    if (deleted) {
      await this.userRepo.update(deleted.id, {
        email: `deleted-${deleted.id}@deleted.dinnerbears.com`,
      });
    }
  }

  async findOrCreateGoogleUser(
    googleId: string,
    email: string,
    displayName: string,
    inviteToken?: string,
    profilePhoto?: string | null,
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
      if (existingByEmail.status === UserStatus.SUSPENDED) {
        throw new AuthFlowError('not_active');
      }
      if (existingByEmail.status !== UserStatus.DELETED) {
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
      // DELETED: fall through — fresh registration; scramble old email before insert
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

    // Free up the email address if a soft-deleted account is still holding it
    await this.releaseDeletedEmail(email.toLowerCase());

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
      profilePhotoPath: profilePhoto ?? null,
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
    profilePhoto?: string | null,
    profileUrl?: string | null,
  ): Promise<UserEntity> {
    const existing = await this.oauthRepo.findOne({
      where: { provider: OAuthProvider.FACEBOOK, providerId: facebookId },
      relations: ['user'],
    });
    if (existing) {
      if (existing.user.status === UserStatus.SUSPENDED || existing.user.status === UserStatus.DELETED) {
        throw new AuthFlowError('not_active');
      }
      if (profileUrl && !existing.profileUrl) {
        await this.oauthRepo.update(existing.id, { profileUrl });
      }
      return existing.user;
    }

    if (email) {
      const existingByEmail = await this.userRepo.findOne({
        where: { email: email.toLowerCase() },
      });
      if (existingByEmail) {
        if (existingByEmail.status === UserStatus.SUSPENDED) {
          throw new AuthFlowError('not_active');
        }
        if (existingByEmail.status !== UserStatus.DELETED) {
          // Account exists but Facebook is not linked — it was either never linked or was
          // disconnected. Do NOT auto-relink; require the user to reconnect via account settings.
          throw new AuthFlowError('provider_not_linked');
        }
        // DELETED: fall through — fresh registration; scramble old email before insert
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

    // Free up the email address if a soft-deleted account is still holding it
    if (email) await this.releaseDeletedEmail(email.toLowerCase());

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
      profilePhotoPath: profilePhoto ?? null,
      inviteId: invite?.id ?? null,
      invitedBy: invite?.createdBy ?? null,
      inviteSource: invite?.type === InviteType.CAMPAIGN_FACEBOOK
        ? InviteSource.FACEBOOK_GROUP
        : isFbNonValidated
          ? InviteSource.NON_VALIDATED_LINK
          : InviteSource.DIRECT,
    });
    await this.userRepo.save(user);

    await this.oauthRepo.save(
      this.oauthRepo.create({
        userId: user.id,
        provider: OAuthProvider.FACEBOOK,
        providerId: facebookId,
        email: email ? email.toLowerCase() : null,
        profileUrl: profileUrl ?? null,
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
    profileUrl?: string | null,
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
        profileUrl: profileUrl ?? null,
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
    hasPassword: boolean;
    hasMultipleMethods: boolean;
  }> {
    const [accounts, user] = await Promise.all([
      this.oauthRepo.find({ where: { userId } }),
      this.userRepo.findOneOrFail({ where: { id: userId } }),
    ]);
    const google = accounts.find((a) => a.provider === OAuthProvider.GOOGLE) ?? null;
    const facebook = accounts.find((a) => a.provider === OAuthProvider.FACEBOOK) ?? null;
    const hasPassword = !!user.passwordHash;
    const methodCount = accounts.length + (hasPassword ? 1 : 0);
    return {
      google: google ? { email: google.email } : null,
      facebook: facebook ? { email: facebook.email } : null,
      hasPassword,
      hasMultipleMethods: methodCount > 1,
    };
  }

  async disconnectProvider(userId: number, provider: OAuthProvider): Promise<void> {
    const user = await this.userRepo.findOneOrFail({ where: { id: userId } });
    const accounts = await this.oauthRepo.find({ where: { userId } });
    const target = accounts.find((a) => a.provider === provider);

    if (!target) throw new NotFoundException(`${provider} is not linked to your account`);

    const hasPassword = !!user.passwordHash;
    if (accounts.length <= 1 && !hasPassword) {
      // No other login method — cannot disconnect
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
            fullName: 'Deleted Member',
            email: `deleted-${user.id}@deleted.dinnerbears.com`,
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

  // ── Email / Password ────────────────────────────────────────────────────────

  async registerWithPassword(
    inviteToken: string,
    fullName: string,
    email: string,
    password: string,
  ): Promise<UserEntity> {
    const lowerEmail = email.toLowerCase();

    const existing = await this.userRepo.findOne({
      where: { email: lowerEmail },
    });
    if (existing && existing.status !== UserStatus.DELETED) {
      throw new ConflictException('email_taken');
    }

    let invite = null;
    try {
      invite = await this.invitesService.validate(inviteToken, lowerEmail);
    } catch (err) {
      if (err instanceof AuthFlowError) throw err;
      if (err instanceof NotFoundException) throw new AuthFlowError('invalid_invite');
      const msg: string = (err as Error).message ?? '';
      if (msg.includes('expired')) throw new AuthFlowError('invite_expired');
      if (msg.includes('already been used') || msg.includes('revoked')) throw new AuthFlowError('invite_used');
      throw new AuthFlowError('invalid_invite');
    }

    if (existing?.status === UserStatus.DELETED) {
      await this.releaseDeletedEmail(lowerEmail);
    }

    const defaultCity = await this.citiesService.findAll().then((c) => c[0]);
    const passwordHash = await bcrypt.hash(password, 12);
    const verificationToken = randomBytes(32).toString('hex');
    const verificationExpires = new Date();
    verificationExpires.setHours(verificationExpires.getHours() + 48);

    const user = this.userRepo.create({
      fullName,
      email: lowerEmail,
      passwordHash,
      emailStatus: EmailStatus.PENDING,
      emailVerificationToken: verificationToken,
      emailVerificationExpiresAt: verificationExpires,
      cityId: defaultCity.id,
      role: UserRole.MEMBER,
      status: UserStatus.ACTIVE,
      inviteId: invite?.id ?? null,
      invitedBy: invite?.createdBy ?? null,
      inviteSource: InviteSource.DIRECT,
    });

    const saved = await this.userRepo.save(user);
    await this.invitesService.redeem(invite, saved);
    await this.sendVerificationEmail(saved, verificationToken);

    return saved;
  }

  async loginWithPassword(
    email: string,
    password: string,
    ctx: SessionContext,
  ): Promise<{ accessToken: string; jti: string; failedAttemptsSinceLastLogin: number; previousLastLoginAt: Date | null }> {
    const user = await this.userRepo.findOne({ where: { email: email.toLowerCase() } });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('invalid_credentials');
    }
    if (user.status === UserStatus.SUSPENDED || user.status === UserStatus.DELETED) {
      throw new UnauthorizedException('not_active');
    }

    // Reset stale failure counter — if last failure was more than 30 min ago, start fresh
    const STALE_MS = 30 * 60 * 1000;
    if (user.lastFailedLoginAt && Date.now() - user.lastFailedLoginAt.getTime() > STALE_MS) {
      await this.userRepo.update(user.id, {
        failedLoginAttempts: 0,
        loginLockedUntil: null,
        lastFailedLoginAt: null,
      });
      user.failedLoginAttempts = 0;
      user.loginLockedUntil = null;
    }

    // Account lockout check
    if (user.loginLockedUntil && user.loginLockedUntil > new Date()) {
      throw new UnauthorizedException({ message: 'account_locked' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      const attempts = (user.failedLoginAttempts ?? 0) + 1;
      // Progressive lockout starting at attempt 4: 60s → 120s → 240s → 480s → capped at 600s
      let lockedUntil: Date | null = null;
      if (attempts >= 4) {
        const lockSeconds = Math.min(60 * Math.pow(2, attempts - 4), 600);
        lockedUntil = new Date(Date.now() + lockSeconds * 1000);
      }
      await this.userRepo.update(user.id, {
        failedLoginAttempts: attempts,
        loginLockedUntil: lockedUntil,
        lastFailedLoginAt: new Date(),
      });
      void this.auditService.log({
        userId: user.id,
        action: 'user.login_failed',
        entityType: 'user',
        entityId: user.id,
        metadata: { attempt: attempts, locked: attempts >= 4 },
        ipAddress: ctx.ipAddress,
      });
      // On first lockout, alert the user and notify admins/mods — fire and forget
      if (attempts === 4) {
        void this.sendLockoutAlerts(user, attempts);
      }
      throw new UnauthorizedException('invalid_credentials');
    }

    if (user.emailStatus === EmailStatus.PENDING) {
      throw new UnauthorizedException('email_not_verified');
    }

    // Capture pre-reset state to return as security info
    const failedAttemptsSinceLastLogin = user.failedLoginAttempts ?? 0;
    const previousLastLoginAt = user.lastLoginAt;

    // Successful login — clear lockout state
    await this.userRepo.update(user.id, {
      failedLoginAttempts: 0,
      loginLockedUntil: null,
      lastFailedLoginAt: null,
    });

    // Persist failed-attempt warning as a notification so it survives past the snackbar
    if (failedAttemptsSinceLastLogin > 0) {
      const noun = failedAttemptsSinceLastLogin === 1 ? 'attempt' : 'attempts';
      void this.notificationsService.create({
        userId: user.id,
        type: 'security_failed_logins',
        title: `${failedAttemptsSinceLastLogin} failed login ${noun} on your account`,
        body: previousLastLoginAt
          ? `Since your last login on ${previousLastLoginAt.toLocaleString()}`
          : 'Since you last logged in',
        actionUrl: '/account/settings',
      });
    }

    const tokens = await this.issueTokens(user, ctx);
    return { ...tokens, failedAttemptsSinceLastLogin, previousLastLoginAt };
  }

  private async sendLockoutAlerts(user: UserEntity, attempts: number): Promise<void> {
    // Email the affected user
    try {
      await this.emailService.sendNow({
        toEmail: user.email,
        toName: user.fullName,
        subject: 'Security alert: your DinnerBears account has been locked',
        htmlBody: `
          <p>Hi ${user.fullName},</p>
          <p>We detected <strong>${attempts} failed login attempts</strong> on your DinnerBears account and have temporarily locked it.</p>
          <p>If this was you, please wait a few minutes and try again.</p>
          <p>If you don't recognize this activity, <a href="${process.env.FRONTEND_URL ?? 'https://dinnerbears.com'}/auth/forgot-password">reset your password immediately</a>.</p>
        `,
        textBody: `Hi ${user.fullName}, we detected ${attempts} failed login attempts and temporarily locked your account. If this wasn't you, reset your password at ${process.env.FRONTEND_URL ?? 'https://dinnerbears.com'}/auth/forgot-password`,
      });
    } catch {
      // Non-fatal
    }

    // In-app notification to all admins and moderators
    try {
      const elevated = await this.userRepo.find({
        where: [{ role: UserRole.ADMIN }, { role: UserRole.MODERATOR }],
        select: ['id'],
      });
      await Promise.all(
        elevated.map((admin) =>
          this.notificationsService.create({
            userId: admin.id,
            type: 'security_lockout',
            title: `Account locked: ${user.fullName}`,
            body: `${attempts} failed login attempts triggered a temporary lockout.`,
            actionUrl: `/members/${user.id}`,
          }),
        ),
      );
    } catch {
      // Non-fatal
    }
  }

  async verifyEmail(token: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { emailVerificationToken: token } });

    if (!user) throw new BadRequestException('invalid_token');
    if (!user.emailVerificationExpiresAt || user.emailVerificationExpiresAt < new Date()) {
      throw new BadRequestException('token_expired');
    }

    await this.userRepo.update(user.id, {
      emailStatus: EmailStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      emailVerificationToken: null,
      emailVerificationExpiresAt: null,
    });
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { email: email.toLowerCase() } });

    // Always return success to prevent email enumeration
    if (!user || user.emailStatus !== EmailStatus.PENDING || !user.passwordHash) return;

    const token = randomBytes(32).toString('hex');
    const expires = new Date();
    expires.setHours(expires.getHours() + 48);

    await this.userRepo.update(user.id, {
      emailVerificationToken: token,
      emailVerificationExpiresAt: expires,
    });

    await this.sendVerificationEmail(user, token);
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { email: email.toLowerCase() } });

    // Always return success to prevent email enumeration
    if (!user || !user.passwordHash || user.status !== UserStatus.ACTIVE) return;

    const token = randomBytes(32).toString('hex');
    const expires = new Date();
    expires.setHours(expires.getHours() + 1);

    await this.userRepo.update(user.id, {
      passwordResetToken: token,
      passwordResetExpiresAt: expires,
    });

    const appUrl = this.configService.get<string>('APP_URL', 'https://dinnerbears.com');
    const resetUrl = `${appUrl}/auth/reset-password?token=${token}`;

    await this.emailService.sendNow({
      toEmail: user.email,
      toName: user.fullName,
      subject: 'Reset your DinnerBears password',
      htmlBody: `
        <h2>Password reset request</h2>
        <p>Hi ${user.fullName},</p>
        <p>Click the link below to reset your password. This link expires in 1 hour.</p>
        <p><a href="${resetUrl}" style="background:#1e4d8c;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;margin:16px 0">Reset Password</a></p>
        <p style="color:#888;font-size:0.85em">If you didn't request this, you can safely ignore this email.</p>
      `,
    });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { passwordResetToken: token } });

    if (!user) throw new BadRequestException('invalid_token');
    if (!user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
      throw new BadRequestException('token_expired');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.userRepo.update(user.id, {
      passwordHash,
      passwordResetToken: null,
      passwordResetExpiresAt: null,
    });
  }

  async setPassword(userId: number, email: string, newPassword: string): Promise<{ needsVerification: boolean }> {
    const lowerEmail = email.toLowerCase();
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.passwordHash) throw new BadRequestException('password_already_set');

    const emailChanged = lowerEmail !== user.email.toLowerCase();

    if (emailChanged) {
      const taken = await this.userRepo.findOne({ where: { email: lowerEmail } });
      if (taken && taken.id !== userId) throw new ConflictException('email_taken');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    if (emailChanged) {
      const verificationToken = randomBytes(32).toString('hex');
      const verificationExpires = new Date();
      verificationExpires.setHours(verificationExpires.getHours() + 48);

      await this.userRepo.update(userId, {
        email: lowerEmail,
        passwordHash,
        emailStatus: EmailStatus.PENDING,
        emailVerifiedAt: null,
        emailVerificationToken: verificationToken,
        emailVerificationExpiresAt: verificationExpires,
      });

      await this.sendVerificationEmail({ ...user, email: lowerEmail, fullName: user.fullName }, verificationToken);
      return { needsVerification: true };
    }

    await this.userRepo.update(userId, {
      passwordHash,
      emailStatus: EmailStatus.ACTIVE,
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
    });
    return { needsVerification: false };
  }

  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || !user.passwordHash) throw new BadRequestException('no_password');

    const match = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!match) throw new UnauthorizedException('invalid_credentials');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.userRepo.update(userId, { passwordHash });
  }

  private async sendVerificationEmail(user: UserEntity, token: string): Promise<void> {
    const appUrl = this.configService.get<string>('APP_URL', 'https://dinnerbears.com');
    const verifyUrl = `${appUrl}/auth/verify-email?token=${token}`;

    await this.emailService.sendNow({
      toEmail: user.email,
      toName: user.fullName,
      subject: 'Verify your DinnerBears email',
      htmlBody: `
        <h2>Welcome to DinnerBears!</h2>
        <p>Hi ${user.fullName},</p>
        <p>Click below to verify your email and activate your account. This link expires in 48 hours.</p>
        <p><a href="${verifyUrl}" style="background:#1e4d8c;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;margin:16px 0">Verify Email</a></p>
        <p style="color:#888;font-size:0.85em">If you didn't create a DinnerBears account, you can safely ignore this email.</p>
      `,
    });
  }
}

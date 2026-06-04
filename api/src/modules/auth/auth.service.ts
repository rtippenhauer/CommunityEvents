import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import * as geoip from 'geoip-lite';
import { UserEntity, EmailStatus, InviteSource } from '../../database/entities/user.entity';
import { OAuthAccountEntity, OAuthProvider } from '../../database/entities/oauth-account.entity';
import { LoginSessionEntity } from '../../database/entities/login-session.entity';
import { InvitesService } from '../invites/invites.service';
import { CitiesService } from '../cities/cities.service';
import { AuditService } from '../audit/audit.service';
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
    private readonly invitesService: InvitesService,
    private readonly citiesService: CitiesService,
    private readonly auditService: AuditService,
  ) {}

  async findOrCreateGoogleUser(
    googleId: string,
    email: string,
    displayName: string,
    inviteToken?: string,
  ): Promise<UserEntity> {
    const existing = await this.oauthRepo.findOne({
      where: { provider: OAuthProvider.GOOGLE, providerId: googleId },
      relations: ['user'],
    });
    if (existing) return existing.user;

    if (!inviteToken) {
      throw new UnauthorizedException('An invite is required to create an account');
    }

    const invite = await this.invitesService.validate(inviteToken, email);

    const defaultCity = await this.citiesService.findAll().then((cities) => cities[0]);

    const user = this.userRepo.create({
      fullName: displayName,
      email: email.toLowerCase(),
      emailStatus: EmailStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      cityId: defaultCity.id,
      inviteId: invite.id,
      inviteSource:
        invite.type === InviteType.CAMPAIGN_FACEBOOK
          ? InviteSource.FACEBOOK_GROUP
          : InviteSource.GOOGLE_OAUTH,
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

    await this.invitesService.redeem(invite, user);

    await this.auditService.log({
      userId: user.id,
      action: 'user.register',
      entityType: 'user',
      entityId: user.id,
      metadata: { provider: 'google', inviteType: invite.type },
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

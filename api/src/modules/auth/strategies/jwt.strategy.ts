import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { UserEntity, UserStatus } from '../../../database/entities/user.entity';
import { LoginSessionEntity } from '../../../database/entities/login-session.entity';
import { AchievementsService } from '../../community/achievements.service';

interface JwtPayload {
  sub: number;
  jti: string;
}

const cookieExtractor = (req: Request): string | null => {
  return req?.cookies?.['access_token'] ?? null;
};

const STAGE_LOGIN_WINDOW_MS = 5 * 60 * 1000;
const PROD_LOGIN_WINDOW_MS = 60 * 60 * 1000;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly loginWindowMs: number;

  constructor(
    configService: ConfigService,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(LoginSessionEntity)
    private readonly sessionRepo: Repository<LoginSessionEntity>,
    private readonly achievementsService: AchievementsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor]),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
    this.loginWindowMs = configService.get<string>('IS_STAGE') === 'true'
      ? STAGE_LOGIN_WINDOW_MS
      : PROD_LOGIN_WINDOW_MS;
  }

  async validate(payload: JwtPayload): Promise<UserEntity> {
    const session = await this.sessionRepo.findOne({
      where: { jwtJti: payload.jti, isActive: true },
    });
    if (!session) throw new UnauthorizedException('Session expired');

    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user || user.status === UserStatus.SUSPENDED || user.status === UserStatus.DELETED) {
      throw new UnauthorizedException('Account not active');
    }

    await this.sessionRepo.update(session.id, { lastActiveAt: new Date() });
    await this.trackQualifyingLogin(user);
    return user;
  }

  private async trackQualifyingLogin(user: UserEntity): Promise<void> {
    const now = new Date();
    const last = user.lastQualifyingLoginAt;
    if (last && now.getTime() - last.getTime() < this.loginWindowMs) return;

    const newCount = user.qualifyingLoginCount + 1;
    await this.userRepo.update(user.id, {
      qualifyingLoginCount: newCount,
      lastQualifyingLoginAt: now,
      lastLoginAt: now,
    });
    user.qualifyingLoginCount = newCount;
    user.lastQualifyingLoginAt = now;
    user.lastLoginAt = now;

    await this.achievementsService.checkLoginAchievements(user.id, newCount);
    await this.achievementsService.checkPatrioticBearAchievement(user.id, now);
  }
}

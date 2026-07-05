import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { UserEntity, UserStatus } from '../../../database/entities/user.entity';
import { LoginSessionEntity } from '../../../database/entities/login-session.entity';

interface JwtPayload {
  sub: number;
  jti: string;
}

const cookieExtractor = (req: Request): string | null => {
  return req?.cookies?.['access_token'] ?? null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(LoginSessionEntity)
    private readonly sessionRepo: Repository<LoginSessionEntity>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor]),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // Runs on every authenticated request (including background polling from a
  // tab left open) — deliberately does NOT track qualifying-login visits here.
  // That's handled in AuthService.me(), which only fires once per real app
  // bootstrap (APP_INITIALIZER), so a page left open all day can't keep
  // racking up visit counts.
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
    return user;
  }
}

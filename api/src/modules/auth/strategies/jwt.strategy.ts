import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import type { users as User } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { UserStatus } from '../../../database/enums';

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
    private readonly prisma: PrismaService,
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
  async validate(payload: JwtPayload): Promise<User> {
    const session = await this.prisma.login_sessions.findFirst({
      where: { jwtJti: payload.jti, isActive: true },
    });
    if (!session) throw new UnauthorizedException('Session expired');

    const user = await this.prisma.users.findUnique({ where: { id: payload.sub } });
    if (!user || user.status === UserStatus.SUSPENDED || user.status === UserStatus.DELETED) {
      throw new UnauthorizedException('Account not active');
    }

    await this.prisma.login_sessions.update({
      where: { id: session.id },
      data: { lastActiveAt: new Date() },
    });
    return user;
  }
}

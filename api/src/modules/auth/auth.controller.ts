import { Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity } from '../../database/entities/user.entity';

@Controller('auth')
export class AuthController {
  private readonly frontendUrl: string;

  constructor(
    private readonly authService: AuthService,
    configService: ConfigService,
  ) {
    this.frontendUrl = configService.get<string>('APP_URL', 'http://localhost:8081');
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleLogin(): void {
    // Passport redirects — inviteToken forwarded as OAuth state in GoogleStrategy
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(
    @Req() req: Request & { user: UserEntity },
    @Res() res: Response,
  ): Promise<void> {
    const { accessToken } = await this.authService.issueTokens(req.user, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    res.redirect(`${this.frontendUrl}/auth/callback`);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: UserEntity) {
    return this.authService.me(user);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(
    @Req() req: Request & { user: UserEntity; cookies: Record<string, string> },
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    const token = req.cookies['access_token'];
    if (token) {
      const payload = this.authService['jwtService'].decode(token) as { jti: string } | null;
      if (payload?.jti) {
        await this.authService.logout(payload.jti, req.user.id);
      }
    }
    res.clearCookie('access_token', { path: '/' });
    return { message: 'Logged out' };
  }
}

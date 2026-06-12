import { Body, Controller, Get, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GoogleCallbackGuard } from '../../common/guards/google-callback.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity } from '../../database/entities/user.entity';
import { FacebookAuthDto } from './dto/facebook-auth.dto';

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
  @UseGuards(GoogleCallbackGuard)
  async googleCallback(
    @Req() req: Request & { user: UserEntity },
    @Res() res: Response,
  ): Promise<void> {
    if (res.headersSent) return; // guard already redirected to error page

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

  @Post('facebook')
  async facebookLogin(
    @Body() dto: FacebookAuthDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    const fbRes = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(dto.accessToken)}`,
    );
    if (!fbRes.ok) throw new UnauthorizedException('Invalid Facebook token');
    const fbUser = await fbRes.json() as { id: string; name: string; email?: string };

    const user = await this.authService.findOrCreateFacebookUser(
      fbUser.id,
      fbUser.email ?? null,
      fbUser.name,
      dto.inviteToken,
    );

    const { accessToken } = await this.authService.issueTokens(user, {
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

    return { message: 'ok' };
  }

  @Post('facebook/link')
  @UseGuards(JwtAuthGuard)
  async facebookLink(
    @Body() dto: FacebookAuthDto,
    @CurrentUser() user: UserEntity,
  ): Promise<{ message: string }> {
    const fbRes = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(dto.accessToken)}`,
    );
    if (!fbRes.ok) throw new UnauthorizedException('Invalid Facebook token');
    const fbUser = await fbRes.json() as { id: string; name: string; email?: string };

    await this.authService.linkFacebook(user.id, fbUser.id, fbUser.email ?? null);
    return { message: 'Facebook account linked' };
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

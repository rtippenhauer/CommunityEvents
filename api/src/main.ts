import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import cookieParser = require('cookie-parser');
import session = require('express-session');
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

// Cookie `secure` flags (here and in AuthController) are gated on this exact
// string. Every deployed instance — prod AND stage — must set NODE_ENV=production;
// there is no "staging" value. Getting this wrong doesn't crash anything, it just
// silently serves non-Secure cookies, which is how a login bug went unnoticed for
// days on the stage instance. Fail loud in the logs instead of failing silently.
function warnIfNodeEnvMisconfigured(): void {
  const nodeEnv = process.env.NODE_ENV;
  const expected = ['production', 'development', 'test'];
  if (nodeEnv !== undefined && !expected.includes(nodeEnv)) {
    const banner = '!'.repeat(72);
    // eslint-disable-next-line no-console
    console.error(
      `\n${banner}\nNODE_ENV is set to "${nodeEnv}" — expected "production" (or ` +
        `"development"/"test" locally). This is almost certainly wrong: deployed ` +
        `instances (including stage) must use NODE_ENV=production, since it also ` +
        `controls the access_token cookie's Secure flag. See CLAUDE.md's deployment ` +
        `note.\n${banner}\n`,
    );
  }
}

async function bootstrap(): Promise<void> {
  warnIfNodeEnvMisconfigured();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.set('query parser', 'extended');
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());

  const configService = app.get(ConfigService);

  // Session required by passport-google-oauth20 for OAuth state/CSRF verification.
  // Short maxAge — only needed for the OAuth handshake (a few seconds).
  app.use(
    session({
      secret: configService.getOrThrow<string>('SESSION_SECRET'),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000, // 10 minutes
      },
    }),
  );

  const uploadPath = configService.get<string>('UPLOAD_PATH', '/app/uploads');

  // Public upload categories, served as static assets with no auth check.
  // Profile photos are intentionally excluded — see ProfilePhotosController,
  // which gates them behind OptionalJwtAuthGuard instead.
  app.useStaticAssets(join(uploadPath, 'locations'), { prefix: '/api/uploads/locations' });
  app.useStaticAssets(join(uploadPath, 'achievements'), { prefix: '/api/uploads/achievements' });
  app.useStaticAssets(join(uploadPath, 'custom-icons'), { prefix: '/api/uploads/custom-icons' });
  app.useStaticAssets(join(uploadPath, 'branding'), { prefix: '/api/uploads/branding' });
  app.useStaticAssets(join(uploadPath, 'avatars'), { prefix: '/api/uploads/avatars' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  const port = configService.get<number>('PORT', 3000);

  await app.listen(port);
}

bootstrap();

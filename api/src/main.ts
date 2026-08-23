import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import cookieParser = require('cookie-parser');
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ensureDeploymentKey } from './common/crypto/secret-key-bootstrap';
import { PrismaService } from './database/prisma/prisma.service';

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

  // Secrets are encrypted at rest as of v2-7, and this is where the deployment
  // settles which key it holds: generating one if (and only if) the database
  // has no secrets to lose, and refusing to start if the key cannot read what
  // is already stored. It runs after app creation because it needs the database
  // to answer that question, and before listen() because the alternative to
  // failing here is discovering it when a password-reset mail does not send at
  // 2am. See secret-key-bootstrap.ts for why the key is not in the database.
  await ensureDeploymentKey(app.get(PrismaService));

  const configService = app.get(ConfigService);

  // No express-session. The comment that used to live here said one was
  // "required by passport-google-oauth20 for OAuth state/CSRF verification".
  // That was never true of this configuration: GoogleStrategy does not pass
  // `state: true`, so passport-oauth2 selects its NullStore -- whose store() and
  // verify() are empty callbacks that never touch req.session -- and the
  // strategy supplies its own `state` string instead. Nothing else in the
  // application read req.session either, so the middleware only allocated a
  // MemoryStore, set a connect.sid cookie on every visitor, and leaked an entry
  // per request, while printing a production warning about all three.
  //
  // Worth being explicit about what this does NOT remove: `state` was already
  // unverified, because NullStore.verify() returns true unconditionally. The
  // open-redirect guard in AuthController is what stands in for it today, and
  // REQ-TENANT-01.8's signed state (v2-8) is the real fix. That design needs no
  // session store either.

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

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

  /**
   * Trust the reverse proxy, so `req.ip` is the visitor rather than NGINX.
   *
   * This deployment always sits behind NGINX Proxy Manager, and for
   * Cloudflare-proxied hosts behind Cloudflare as well. Without this Express
   * reports the nearest hop, which meant **every request in the system looked
   * like it came from `::ffff:127.0.0.1`** -- one address shared by every
   * visitor on earth.
   *
   * Two things key on the client address and both were silently
   * deployment-wide rather than per-visitor:
   *
   *  - **Rate limiting.** The throttler buckets by IP, so the 5/min on
   *    `/auth/login` and `/auth/register` was five attempts for *everyone
   *    combined*. One person fumbling a password locked out the rest.
   *  - **The demo per-IP cap (v2-14).** Two demos per address became two demos
   *    for the whole deployment, which is how Rob's office request was refused
   *    for an address he had never used. Found that way.
   *
   * `true` takes the left-most entry of `X-Forwarded-For`, which is the real
   * client for both shapes this deployment serves: Cloudflare sets it to the
   * originating address on proxied hosts, and NGINX sets it from the socket on
   * the grey-clouded ones.
   *
   * **It is spoofable, and that is an accepted trade.** A client can prepend
   * its own `X-Forwarded-For` and claim any address. What that buys is a
   * reset rate-limit bucket and more than two demos -- and the demo pool is
   * bounded by `MAX_LIVE_DEMOS` regardless, which is the limit that actually
   * protects anything. Pinning this to the proxy's real address instead would
   * mean maintaining Cloudflare's published ranges, for a guarantee neither
   * consumer needs.
   */
  app.set('trust proxy', true);

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
  // unverified, because NullStore.verify() returns true unconditionally. v2-8
  // supplied the real fix -- REQ-TENANT-01.8's signed state, in
  // `oauth/oauth-state.util.ts`, HMACed under a key derived from JWT_SECRET and
  // verified by us rather than by Passport. It needs no session store either,
  // which is why removing the middleware first cost nothing.

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

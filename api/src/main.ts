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
   * **This used to be `true`, which was wrong, and the comment here used to
   * argue otherwise.** `true` believes the whole chain and takes the left-most
   * entry, so any client could prepend `X-Forwarded-For: 1.2.3.4` and be
   * whoever it liked. The old reasoning was that this only bought a reset demo
   * cap, bounded anyway by `MAX_LIVE_DEMOS` -- but the demo cap is not the only
   * consumer. **`req.ip` also buckets the 5/min throttle on `/auth/login` and
   * `/auth/register`,** so a spoofable address means an attacker rotating a
   * header has no login rate limit at all. Trading away brute-force protection
   * to fix a shared rate-limit bucket is a worse deal than the one it replaced.
   * Found by review (ChatGPT, 2026-10-02).
   *
   * **Trust the hop, not the header.** Express walks `X-Forwarded-For` from the
   * socket leftwards and stops at the first address it does not trust, so
   * trusting only private networks means a forged left-most entry is ignored:
   * NGINX appends the real peer to whatever arrived
   * (`$proxy_add_x_forwarded_for`), that appended address is the right-most and
   * untrusted, and it wins. A forged header can therefore only ever name an
   * address further left than the truth, which is never read.
   *
   * The presets cover this deployment's shape -- NGINX Proxy Manager runs in
   * Docker on the same host, so the peer is loopback or RFC1918. A deployment
   * that puts something public in front (Cloudflare proxying, rather than the
   * grey-clouded hosts the demo requires) adds those ranges through
   * `TRUSTED_PROXIES` rather than by widening this to `true` again.
   *
   * The consequence of getting this *too narrow* is the old shared-bucket bug
   * back, which is visible and annoying. Too wide is an invisible hole in the
   * login throttle. So it fails narrow deliberately.
   */
  const trustedProxies = (process.env.TRUSTED_PROXIES ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal', ...trustedProxies]);

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
  // Added 2026-10-05, after a screenshot attached to a report 404'd on stage.
  // Both of these used to write to the uploads ROOT and return a URL under
  // `/api/uploads/`, which nothing serves -- so every attachment was stored
  // correctly and displayed as a broken image. Serving the root instead would
  // have "fixed" it by exposing profile photos, which the comment above exists
  // to prevent; a directory per category is the shape this file already uses.
  app.useStaticAssets(join(uploadPath, 'reports'), { prefix: '/api/uploads/reports' });
  app.useStaticAssets(join(uploadPath, 'feedback'), { prefix: '/api/uploads/feedback' });

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

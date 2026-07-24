import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import cookieParser = require('cookie-parser');
import session = require('express-session');
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

async function bootstrap(): Promise<void> {
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

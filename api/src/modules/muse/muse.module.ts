import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { FacebookModule } from '../facebook/facebook.module';
import { FacebookHeadcountModule } from '../facebook/facebook-headcount.module';
import { LocationsModule } from '../locations/locations.module';
import { InvitesModule } from '../invites/invites.module';
import { AuditModule } from '../audit/audit.module';
import { MuseController } from './muse.controller';
import { AppConfigModule } from '../app-config/app-config.module';
import { MuseService } from './muse.service';
import { MuseTenantMiddleware } from './muse-tenant.middleware';
import { MuseTokenGuard } from './muse-token.guard';

/**
 * The Muse integration API (v2-29).
 *
 * The middleware is mounted here rather than in `AppModule` so it cannot reach
 * a route that is not Muse's. That matters more than tidiness: it is what turns
 * a bearer token into a tenant context, and a wider mount would let any request
 * anywhere in the deployment change which community it runs as by presenting a
 * header.
 *
 * `forRoutes('muse/{*splat}')` is Express 5 / path-to-regexp v8 syntax; the
 * older `'muse/*'` throws at boot on this Nest version rather than matching.
 * Nest also mounts module middleware at a path and Express strips it, so
 * `req.path` is `/` inside it -- the `v2-4` trap. Nothing here reads the path,
 * which is the simplest way not to trip over that.
 *
 * Ordering: `TenantMiddleware` is applied in `AppModule` and runs first, so an
 * unknown Host is still refused before any of this. `MuseTenantMiddleware` then
 * nests inside the context it opened and replaces the tenant with the token's.
 */
@Module({
  imports: [
    IntegrationsModule,
    FacebookModule,
    FacebookHeadcountModule,
    LocationsModule,
    InvitesModule,
    AuditModule,
    // Not @Global, unlike PrismaModule: leaving this out is a runtime boot
    // failure that compiles clean (v2-10).
    AppConfigModule,
  ],
  controllers: [MuseController],
  providers: [MuseService, MuseTokenGuard],
})
export class MuseModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(MuseTenantMiddleware).forRoutes('muse/{*splat}');
  }
}

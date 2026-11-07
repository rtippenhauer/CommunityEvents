import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { EmailModule } from '../email/email.module';
import { InvitesModule } from '../invites/invites.module';
import { CalendarModule } from '../calendar/calendar.module';
import { CommunityModule } from '../community/community.module';
import { LocationsModule } from '../locations/locations.module';
import { AppConfigModule } from '../app-config/app-config.module';
import { FacebookHeadcountModule } from '../facebook/facebook-headcount.module';
import { AuditModule } from '../audit/audit.module';
import { CitiesModule } from '../cities/cities.module';
import type { events as EventRow, event_guest_links as EventGuestLink, event_rsvps as EventRsvp, invites as Invite, locations as LocationRow, users as User } from '@prisma/client';

@Module({
  imports: [
    EmailModule,
    InvitesModule,
    CalendarModule,
    CommunityModule,
    LocationsModule,
    AppConfigModule,
    // The merged headcount for `goingCount` (v2-29). Its own module, which
    // imports nothing but Prisma -- FacebookModule needs EventsModule for the
    // sync's RSVP confirmation, so defining the headcount there would close a
    // cycle.
    FacebookHeadcountModule,
    AuditModule,
    CitiesModule,
  ],
  providers: [EventsService],
  controllers: [EventsController],
  exports: [EventsService],
})
export class EventsModule {}

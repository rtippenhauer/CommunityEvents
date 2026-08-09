import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { EmailModule } from '../email/email.module';
import { InvitesModule } from '../invites/invites.module';
import { CalendarModule } from '../calendar/calendar.module';
import { CommunityModule } from '../community/community.module';
import { LocationsModule } from '../locations/locations.module';
import { AppConfigModule } from '../app-config/app-config.module';
import type { events as EventRow, event_guest_links as EventGuestLink, event_rsvps as EventRsvp, invites as Invite, locations as LocationRow, users as User } from '@prisma/client';

@Module({
  imports: [
    EmailModule,
    InvitesModule,
    CalendarModule,
    CommunityModule,
    LocationsModule,
    AppConfigModule,
  ],
  providers: [EventsService],
  controllers: [EventsController],
  exports: [EventsService],
})
export class EventsModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEntity } from '../../database/entities/event.entity';
import { EventGuestLinkEntity } from '../../database/entities/event-guest-link.entity';
import { EventRsvpEntity } from '../../database/entities/event-rsvp.entity';
import { RestaurantEntity } from '../../database/entities/restaurant.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { EmailModule } from '../email/email.module';
import { InvitesModule } from '../invites/invites.module';
import { CalendarModule } from '../calendar/calendar.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([EventEntity, EventRsvpEntity, EventGuestLinkEntity, RestaurantEntity, UserEntity]),
    EmailModule,
    InvitesModule,
    CalendarModule,
  ],
  providers: [EventsService],
  controllers: [EventsController],
  exports: [EventsService],
})
export class EventsModule {}

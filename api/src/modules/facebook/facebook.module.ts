import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EventsModule } from '../events/events.module';
import { FacebookHeadcountModule } from './facebook-headcount.module';
import { FacebookAccountsController } from './facebook-accounts.controller';
import { FacebookAccountsService } from './facebook-accounts.service';
import { FacebookSyncService } from './facebook-sync.service';

/**
 * The Facebook mirror (v2-29): the people a community has seen on its Going
 * lists, the admin's links to members, and the sync that applies them.
 *
 * Imports `EventsModule` for the ordinary RSVP confirmation the sync sends
 * (rule 7), and `FacebookHeadcountModule` for the merged count. The headcount
 * is deliberately *not* defined here -- see that module for why the cycle with
 * Events would otherwise close.
 */
@Module({
  imports: [AuditModule, EventsModule, FacebookHeadcountModule],
  controllers: [FacebookAccountsController],
  providers: [FacebookAccountsService, FacebookSyncService],
  exports: [FacebookAccountsService, FacebookSyncService],
})
export class FacebookModule {}

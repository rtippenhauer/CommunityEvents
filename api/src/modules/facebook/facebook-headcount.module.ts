import { Module } from '@nestjs/common';
import { FacebookHeadcountService } from './facebook-headcount.service';

/**
 * The merged headcount, in its own module (v2-29).
 *
 * Separate from `FacebookModule` for one structural reason: `EventsModule`
 * needs the headcount (the event list's `goingCount` includes Facebook people),
 * and `FacebookModule` needs `EventsModule` (the sync sends the ordinary RSVP
 * confirmation). Putting the headcount in `FacebookModule` would make those two
 * circular.
 *
 * This module depends on nothing but Prisma, which is what breaks the cycle --
 * so it stays that way. A new dependency here is the thing to be suspicious of.
 */
@Module({
  providers: [FacebookHeadcountService],
  exports: [FacebookHeadcountService],
})
export class FacebookHeadcountModule {}

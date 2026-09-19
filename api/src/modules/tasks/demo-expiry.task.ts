import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DemoService } from '../demo/demo.service';

/**
 * Deletes demo communities whose seven days are up (v2-14).
 *
 * **Daily, not weekly.** A demo's promise is that it lasts a week; the sweep
 * frequency is only how often that promise is honoured, so a weekly sweep would
 * let one live anywhere between seven and fourteen days depending on when it
 * was created. Daily makes the lifetime what the notice on the page says it is.
 *
 * 09:00 UTC is 4-5am Eastern. The obvious 04:00 UTC is 11pm-midnight Eastern --
 * squarely in the evening for the audience most likely to be trying the product,
 * and deleting somebody's demo mid-session is the worst possible moment for it.
 *
 * The work itself is `DemoService.deleteExpired`, which also reclaims demos
 * nobody has signed into for two days and clears lapsed unconfirmed requests;
 * it lives there rather than here so the caps, the creation and the deletion of
 * a demo are all in one place.
 */
@Injectable()
export class DemoExpiryTask {
  private readonly logger = new Logger(DemoExpiryTask.name);

  constructor(private readonly demoService: DemoService) {}

  // A raw expression rather than a CronExpression constant: the enum has no
  // 9am entry, and spelling it out is what lets the 09:00 choice above be
  // justified in a comment next to the number it refers to.
  @Cron('0 9 * * *')
  async runDemoExpiry(): Promise<void> {
    // No runUnscoped here: deleteExpired takes its own waivers per step, which
    // keeps each one's reason next to the query it covers.
    const { demos, idle, requests } = await this.demoService.deleteExpired();
    if (demos > 0 || requests > 0) {
      this.logger.log(
        `Demo sweep: deleted ${demos} demo(s) (${idle} of them idle rather than expired), ` +
          `${requests} lapsed request(s).`,
      );
    }
  }
}

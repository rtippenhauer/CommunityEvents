import { Module } from '@nestjs/common';
import { SystemReportsService } from './system-reports.service';
import { SystemBugsController } from './system-bugs.controller';
import { DemoFeedbackController } from './demo-feedback.controller';
import { AppConfigModule } from '../app-config/app-config.module';

/**
 * The two report channels that cross a tenant boundary (v2-32).
 *
 * One module because they share `SystemReportsService` and the same reasoning
 * about global tables; two controllers because their audiences are opposites
 * and collapsing them would make it easy to widen one by editing the other.
 *
 * `AppConfigModule` is imported rather than assumed global -- only
 * `PrismaModule` is `@Global` here, and injecting `AppConfigService` without
 * importing its module is a *boot* failure that `tsc` passes clean (the trap
 * v2-10 recorded).
 */
@Module({
  imports: [AppConfigModule],
  controllers: [SystemBugsController, DemoFeedbackController],
  providers: [SystemReportsService],
  exports: [SystemReportsService],
})
export class SystemReportsModule {}

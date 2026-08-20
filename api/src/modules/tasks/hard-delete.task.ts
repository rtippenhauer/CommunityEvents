import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { unlink } from 'fs/promises';
import { join } from 'path';
import type { users as User } from '@prisma/client';
import { runUnscoped } from '../../common/tenant/tenant-store';
import { AUTO_DELETE_ELIGIBLE } from '../../common/utils/service-account.util';
import { PrismaService } from '../../database/prisma/prisma.service';
import { FacebookDeletionStatus, UserStatus } from '../../database/enums';
import { AuditService } from '../audit/audit.service';

const LOCAL_PHOTO_PREFIX = '/api/v1/uploads/profiles/';

@Injectable()
export class HardDeleteTask {
  private readonly logger = new Logger(HardDeleteTask.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * The waiver wraps this method rather than a private delegate because the
   * account-lifecycle e2e suite calls runHardDelete() directly, outside any
   * request — and purging an account has to reach every tenant's rows anyway,
   * since `users` is not yet tenant-scoped (that is v2-6, REQ-TENANT-01.5).
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  runHardDelete(): Promise<void> {
    return runUnscoped('hard-delete purges accounts across every tenant', () =>
      this.purgeDueAccounts(),
    );
  }

  private async purgeDueAccounts(): Promise<void> {
    const now = new Date();
    const due = await this.prisma.users.findMany({
      where: {
        // Belt and braces: an admin, system admin or service account should
        // never reach status DELETED, because every path that sets it refuses
        // them. This is here so that if one ever does -- a hand-edited row, a
        // future path that forgets -- the purge does not quietly destroy the
        // community's only operator, or the account its own audit and
        // release-notes rows point at.
        ...AUTO_DELETE_ELIGIBLE,
        status: UserStatus.DELETED,
        hardDeleteAt: { lte: now },
      },
    });

    if (due.length === 0) return;
    this.logger.log(`Hard-delete cron: processing ${due.length} account(s)`);

    for (const user of due) {
      try {
        await this.processUser(user);
      } catch (err) {
        this.logger.error(`Hard-delete failed for user ${user.id}: ${(err as Error).message}`);
      }
    }
  }

  private async processUser(user: User): Promise<void> {
    // Delete local photo from disk before nulling the path
    if (user.profilePhotoPath?.startsWith(LOCAL_PHOTO_PREFIX)) {
      const filename = user.profilePhotoPath.replace(LOCAL_PHOTO_PREFIX, '');
      const uploadPath = process.env.UPLOAD_PATH ?? '/app/uploads';
      try {
        await unlink(join(uploadPath, 'profiles', filename));
      } catch {
        // File may already be gone — not fatal
      }
    }

    // Overwrite PII — users row stays as tombstone for FK integrity
    await this.prisma.users.update({
      where: { id: user.id },
      data: {
        fullName: 'Deleted Member',
        email: `deleted-${user.id}@deleted.dinnerbears.com`,
        passwordHash: null,
        profilePhotoPath: null,
        emailVerifiedAt: null,
        hardDeleteAt: null,
      },
    });

    // Mark any pending facebook deletion requests as completed
    await this.prisma.facebook_deletion_requests.updateMany({
      where: { dinnerbearsUserId: user.id, status: FacebookDeletionStatus.PENDING },
      data: { status: FacebookDeletionStatus.COMPLETED, completedAt: new Date() },
    });

    await this.auditService.log({
      action: 'account_hard_deleted',
      entityType: 'user',
      entityId: user.id,
    });

    this.logger.log(`Hard-deleted user ${user.id}`);
  }
}

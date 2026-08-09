import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { unlink } from 'fs/promises';
import { join } from 'path';
import type { users as User } from '@prisma/client';
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

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runHardDelete(): Promise<void> {
    const now = new Date();
    const due = await this.prisma.users.findMany({
      where: {
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

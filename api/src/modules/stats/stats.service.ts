import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { EventStatus, UserStatus } from '../../database/enums';

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicStats(): Promise<{
    memberCount: number;
    dinnerCount: number;
    locationCount: number;
  }> {
    const [memberCount, dinnerCount, locationCount] = await Promise.all([
      this.prisma.users.count({ where: { status: UserStatus.ACTIVE } }),
      this.prisma.events.count({ where: { status: EventStatus.PUBLISHED } }),
      this.prisma.locations.count({ where: { isActive: true } }),
    ]);
    return { memberCount, dinnerCount, locationCount };
  }
}

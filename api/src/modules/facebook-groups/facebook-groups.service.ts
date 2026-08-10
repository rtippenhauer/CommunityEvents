import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';

@Injectable()
export class FacebookGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.facebook_group_config.findMany({
      where: { isActive: true },
      include: { city: true },
    });
  }
}

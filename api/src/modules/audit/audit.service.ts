import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';

export interface AuditLogParams {
  userId?: number;
  action: string;
  entityType?: string;
  entityId?: number;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(params: AuditLogParams): Promise<void> {
    await this.prisma.audit_log.create({
      data: {
        userId: params.userId ?? null,
        action: params.action,
        entityType: params.entityType ?? null,
        entityId: params.entityId ?? null,
        // Prisma distinguishes a SQL NULL from a JSON null in a nullable Json
        // column; TypeORM did not. DbNull reproduces what it wrote before.
        metadata: (params.metadata as Prisma.InputJsonValue) ?? Prisma.DbNull,
        ipAddress: params.ipAddress ?? null,
      },
    });
  }
}

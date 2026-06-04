import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogEntity } from '../../database/entities/audit-log.entity';

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
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditRepo: Repository<AuditLogEntity>,
  ) {}

  async log(params: AuditLogParams): Promise<void> {
    const entry = this.auditRepo.create({
      userId: params.userId ?? null,
      action: params.action,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
      metadata: params.metadata ?? null,
      ipAddress: params.ipAddress ?? null,
    });
    await this.auditRepo.save(entry);
  }
}

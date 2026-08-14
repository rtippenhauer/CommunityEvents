import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { currentTenantId } from '../../common/tenant/tenant-store';
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
  /**
   * Cached because it cannot change: the database enforces exactly one root
   * tenant via the unique index on `root_marker`.
   */
  private rootTenantId?: number;

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
        ...(await this.systemTenant()),
      },
    });
  }

  /**
   * The tenant a *system* audit entry belongs to.
   *
   * Normally nothing: a request has a tenant in context and the scoping
   * extension stamps the row. The exception is the scheduled sweeps, which run
   * inside `runUnscoped` because they cross every tenant — and there the
   * extension deliberately stamps nothing, so `tenant_id` would fall back to its
   * sentinel default and the foreign key would reject the insert. That is the
   * fail-closed behaviour working as intended, but an audit row is the one thing
   * that must not be quietly dropped, so system actions are attributed to the
   * root tenant instead. Under REQ-TENANT-01.7 the root tenant is the
   * system-admin tenant, which is exactly whose log these belong in.
   *
   * A missing context (as opposed to a waived one) is left alone so the
   * extension still throws: that means someone called this from a path that
   * should have had a tenant and did not.
   */
  private async systemTenant(): Promise<{ tenantId?: number }> {
    if (currentTenantId() !== null) return {};

    this.rootTenantId ??= (
      await this.prisma.tenants.findFirstOrThrow({ where: { rootMarker: true } })
    ).id;

    return { tenantId: this.rootTenantId };
  }
}

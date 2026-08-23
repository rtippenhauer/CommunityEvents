import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma/prisma.service';
import { TenantResolutionService } from '../../common/tenant/tenant-resolution.service';
import { runUnscoped } from '../../common/tenant/tenant-store';
import { tenantGetsServiceAccount } from '../../database/prisma/service-account.provision';
import { normalizeTenantDomain } from '../../common/utils/tenant-domain.util';
import { LEGAL_DEFAULT_ROWS } from '../../common/legal/legal-defaults';
import { EmailStatus, UserRole, UserStatus } from '../../database/enums';
import {
  AUTOMATION_ACCOUNT_EMAIL,
  AUTOMATION_ACCOUNT_NAME,
} from '../../common/utils/service-account.util';
import { AuditService } from '../audit/audit.service';
import {
  TENANT_SCOPED_MODELS,
  type TenantScopedModel,
} from '../../common/tenant/tenant-scoped-models';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { DeleteTenantDto } from './dto/delete-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';

/** Matches AuthService.register, so this hash verifies like any other. */
const BCRYPT_ROUNDS = 12;

export interface TenantRow {
  id: number;
  slug: string;
  domain: string;
  isRoot: boolean;
  status: string;
  dbMode: string;
  createdAt: Date;
  eventCount: number;
  locationCount: number;
  /**
   * That community's own mail_domain setting, or '' when it inherits the
   * deployment's. Returned so the edit form can show what is actually set
   * rather than an empty box that might mean either.
   */
  mailDomain: string;
  memberCount: number;
}

/**
 * The tenant registry, as operated by the system admin (REQ-TENANT-01.7).
 *
 * This is the first service in the application whose whole job is to see every
 * tenant, so two things are true here that are true nowhere else:
 *
 *  - `tenants` is a global model, so reads and writes of the registry itself
 *    need no waiver. The extension leaves it alone.
 *  - The per-tenant *counts* are a different matter. They aggregate scoped
 *    models across every tenant, which is exactly what the scoping exists to
 *    prevent, so they go through `runUnscoped` with a stated reason rather than
 *    inheriting the caller's tenant and silently reporting the root tenant's
 *    numbers on every row.
 *
 * Every mutation clears the resolution cache. Without that, a domain or status
 * change appears to do nothing for up to the cache TTL, which reads as a broken
 * form rather than as a stale cache.
 */
@Injectable()
export class TenantsAdminService {
  private readonly logger = new Logger(TenantsAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantResolution: TenantResolutionService,
    private readonly auditService: AuditService,
  ) {}

  async findAll(): Promise<TenantRow[]> {
    const tenants = await this.prisma.tenants.findMany({
      orderBy: [{ isRoot: 'desc' }, { slug: 'asc' }],
    });

    // Two grouped counts rather than a correlated subquery per row: the number
    // of tenants is small, but the number of events is not, and `groupBy` gives
    // one index scan each instead of one query per tenant.
    //
    // Awaited inside the callback, not returned from it: Prisma promises are
    // lazy, so returning them would build the queries in the unscoped context
    // and run them outside it.
    const [events, locations, members, mailRows] = await runUnscoped(
      'system admin tenant list reports the size of every tenant',
      async () =>
        await Promise.all([
          this.prisma.events.groupBy({ by: ['tenantId'], _count: { _all: true } }),
          this.prisma.locations.groupBy({ by: ['tenantId'], _count: { _all: true } }),
          // Real people only: the service account exists in every community and
          // counting it would make an empty community look like it has one
          // member. Same rule the member directory and leaderboard follow.
          this.prisma.users.groupBy({
            by: ['tenantId'],
            _count: { _all: true },
            where: { isServiceAccount: false },
          }),
          this.prisma.app_config.findMany({
            where: { configKey: 'mail_domain' },
            select: { tenantId: true, configValue: true },
          }),
        ]),
    );

    const eventsByTenant = new Map(events.map((r) => [r.tenantId, r._count._all]));
    const locationsByTenant = new Map(locations.map((r) => [r.tenantId, r._count._all]));
    const membersByTenant = new Map(members.map((r) => [r.tenantId, r._count._all]));
    const mailByTenant = new Map(mailRows.map((r) => [r.tenantId, r.configValue]));

    return tenants.map((t) => ({
      id: t.id,
      slug: t.slug,
      domain: t.domain,
      isRoot: t.isRoot,
      status: t.status,
      dbMode: t.dbMode,
      createdAt: t.createdAt,
      eventCount: eventsByTenant.get(t.id) ?? 0,
      locationCount: locationsByTenant.get(t.id) ?? 0,
      memberCount: membersByTenant.get(t.id) ?? 0,
      mailDomain: mailByTenant.get(t.id) ?? '',
    }));
  }

  async findOne(id: number): Promise<TenantRow> {
    const tenant = (await this.findAll()).find((t) => t.id === id);
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async create(dto: CreateTenantDto, actorId: number): Promise<TenantRow> {
    const domain = this.normalizeOrThrow(dto.domain);
    const slug = (dto.slug ?? domain.split('.')[0]).toLowerCase();
    this.assertSlug(slug);

    // Never a root tenant, for the same reason provision-tenant.ts cannot make
    // one: the database permits exactly one, and a second would mean a second
    // system admin. There is no field on the DTO to ask for it -- this writes
    // false/NULL unconditionally.
    let created;
    try {
      created = await this.prisma.tenants.create({
        data: { slug, domain, status: dto.status ?? 'active', isRoot: false, rootMarker: null },
      });
    } catch (err) {
      throw this.translateUniqueViolation(err, domain, slug);
    }

    // Same service account provision-tenant.ts makes, so a community created
    // from the UI is not subtly different from one created by the script --
    // including that it exists on stage only. Nothing in production can use a
    // non-root one: automationLogin refuses it there, no code path looks one up,
    // and audit_log.user_id is nullable. See tenantGetsServiceAccount.
    //
    // runUnscoped because the write belongs to the *new* tenant while the
    // request is scoped to the root one -- without the waiver the extension
    // would stamp the root tenant's id onto it.
    // Looked up unconditionally: the first admin below needs it too, and
    // gating it on the service-account decision silently stopped creating that
    // admin -- which is the whole reason a new community is reachable at all.
    const city = await this.prisma.cities.findFirst({ orderBy: { id: 'asc' } });
    if (city && tenantGetsServiceAccount(false)) {
      await runUnscoped("creating the new tenant's own service account", async () => {
        await this.prisma.users.create({
          data: {
            tenantId: created.id,
            cityId: city.id,
            fullName: AUTOMATION_ACCOUNT_NAME,
            email: AUTOMATION_ACCOUNT_EMAIL,
            role: UserRole.AUTOMATION,
            status: UserStatus.ACTIVE,
            emailStatus: EmailStatus.ACTIVE,
            emailVerifiedAt: new Date(),
            isServiceAccount: true,
          },
        });
      });
    } else if (!city) {
      // Only reachable on a database that was never seeded; the tenant itself is
      // fine, so this is a warning rather than a failed create.
      this.logger.warn(
        `Tenant ${created.slug} created without a service account: no city exists to attach it to.`,
      );
    }

    // The community's first admin.
    //
    // Without one a new community is a dead end: registration needs an invite,
    // invites must come from an existing member of that tenant, and the only
    // other account is the `disabled` service account just created. This is the
    // same thing bootstrap.ts does for the root tenant.
    //
    // runUnscoped for the same reason as the service account above -- the row
    // belongs to the new tenant while the request is scoped to the root one.
    if (dto.adminEmail && dto.adminPassword && city) {
      if (dto.adminEmail.toLowerCase() === AUTOMATION_ACCOUNT_EMAIL) {
        throw new BadRequestException(
          'That address is reserved for the community service account.',
        );
      }
      const passwordHash = await bcrypt.hash(dto.adminPassword, BCRYPT_ROUNDS);
      await runUnscoped("creating the new tenant's first admin", async () => {
        await this.prisma.users.create({
          data: {
            tenantId: created.id,
            cityId: city.id,
            fullName: dto.adminName?.trim() || 'Admin',
            email: dto.adminEmail!.toLowerCase(),
            passwordHash,
            role: UserRole.ADMIN,
            status: UserStatus.ACTIVE,
            // Verified on creation: the operator is vouching for the address by
            // typing it, and an unverified first admin could not complete
            // verification anyway without an admin to ask.
            emailStatus: EmailStatus.ACTIVE,
            emailVerifiedAt: new Date(),
          },
        });
      });
      this.logger.log(`Tenant ${created.slug} created with admin ${dto.adminEmail}`);
    } else {
      this.logger.warn(
        `Tenant ${created.slug} created with no admin. Nobody can sign in to it ` +
          `until one exists — registration requires an invite, and invites require a member.`,
      );
    }

    // The community's mail domain, if the operator named one.
    //
    // Written as an ordinary app_config row so it is the same setting its admin
    // sees in Settings -- this is a convenience for setup, not a second place
    // the value can live. Blank is a real answer and stays unwritten: it means
    // "inherit the deployment's", which AppConfigService resolves at read time.
    //
    // runUnscoped for the same reason as the two writes above: the row belongs
    // to the new tenant while the request is scoped to the root one.
    const mailDomain = normalizeTenantDomain(dto.mailDomain ?? '');
    if (mailDomain) await this.writeMailDomain(created.id, mailDomain, actorId);

    // Terms and a Privacy Policy, so /terms and /privacy are never a titled
    // page with nothing under it. These are the platform's templates, not
    // finished documents -- `legal_reviewed_at` stays empty until the
    // community's admin confirms them, and the admin UI says so until it is.
    // Same runUnscoped reasoning as the writes above.
    await runUnscoped("seeding the new tenant's legal copy", async () => {
      await this.prisma.app_config.createMany({
        data: LEGAL_DEFAULT_ROWS.map((row) => ({ ...row, tenantId: created.id })),
      });
    });

    this.tenantResolution.clearCache();
    await this.auditService.log({
      userId: actorId,
      action: 'tenant.create',
      entityType: 'tenant',
      entityId: created.id,
      metadata: { slug, domain },
    });
    return this.findOne(created.id);
  }

  async update(id: number, dto: UpdateTenantDto, actorId: number): Promise<TenantRow> {
    const existing = await this.prisma.tenants.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tenant not found');

    const data: Prisma.tenantsUpdateInput = {};

    if (dto.domain !== undefined) {
      const domain = this.normalizeOrThrow(dto.domain);
      // The root tenant's domain is owned by bootstrap.ts, which rewrites it
      // from ROOT_TENANT_URL/APP_URL on every run -- a change made here would be
      // silently reverted by the next deploy. Worse, the system admin is by
      // definition browsing *on* that domain, so a successful change would lock
      // them out of the only host this API answers on.
      if (existing.isRoot && domain !== existing.domain) {
        throw new BadRequestException(
          'The root tenant domain is set by ROOT_TENANT_URL and applied by bootstrap, not here.',
        );
      }
      data.domain = domain;
    }

    if (dto.slug !== undefined) {
      this.assertSlug(dto.slug);
      data.slug = dto.slug.toLowerCase();
    }

    if (dto.status !== undefined) {
      // Suspending the root tenant would make TenantMiddleware answer 503 for
      // every request to it, including the one that would un-suspend it. There
      // is no way back except a manual database edit.
      if (existing.isRoot && dto.status === 'suspended') {
        throw new BadRequestException('The root tenant cannot be suspended.');
      }
      data.status = dto.status;
    }

    // Written before the "nothing else changed" return below, because the mail
    // domain is not a column on `tenants` -- it is that community's own
    // app_config row, and a request that changes only it still changes
    // something.
    let mailDomainChanged = false;
    if (dto.mailDomain !== undefined) {
      const mailDomain = normalizeTenantDomain(dto.mailDomain);
      await this.writeMailDomain(id, mailDomain, actorId);
      mailDomainChanged = true;
    }

    if (Object.keys(data).length === 0) {
      if (mailDomainChanged) {
        await this.auditService.log({
          userId: actorId,
          action: 'tenant.update',
          entityType: 'tenant',
          entityId: id,
          metadata: { changed: ['mailDomain'] },
        });
      }
      return this.findOne(id);
    }

    try {
      await this.prisma.tenants.update({ where: { id }, data });
    } catch (err) {
      throw this.translateUniqueViolation(
        err,
        dto.domain ?? existing.domain,
        dto.slug ?? existing.slug,
      );
    }

    this.tenantResolution.clearCache();
    await this.auditService.log({
      userId: actorId,
      action: 'tenant.update',
      entityType: 'tenant',
      entityId: id,
      metadata: { changed: [...Object.keys(data), ...(mailDomainChanged ? ['mailDomain'] : [])] },
    });
    return this.findOne(id);
  }

  /**
   * Permanently deletes a community and everything in it.
   *
   * Three gates, in order, because this is the one irreversible action in the
   * system:
   *
   *  1. never the root tenant -- it is the host this API answers on, and the
   *     system admin is browsing it;
   *  2. it must already be suspended, so taking a community offline and
   *     destroying it are separate decisions made at separate times. Suspension
   *     is reversible and instant, which makes it the right first step
   *     regardless;
   *  3. the caller retypes the domain. A boolean can be sent by accident; a
   *     domain cannot be supplied without having read which community it names.
   *
   * The purge itself filters by `tenantId` **explicitly** rather than relying on
   * the scoping extension. Everywhere else in this codebase the extension is the
   * enforcement point and adding a manual filter is discouraged -- here the cost
   * of being wrong is every community's data, and a bare `deleteMany({})` that
   * silently lost its filter (an unextended transaction client, say) would do
   * exactly that. The filter is written where it can be read.
   *
   * Order does not matter: every foreign key among the scoped tables is
   * ON DELETE CASCADE, so deleting a parent takes its children and deleting a
   * child first is equally fine. Only the `tenant_id` keys are RESTRICT, which
   * is what makes the final `tenants.delete()` a safety net -- if this list ever
   * misses a table, that call fails loudly instead of leaving orphans.
   */
  async remove(
    id: number,
    dto: DeleteTenantDto,
    actorId: number,
  ): Promise<{ id: number; domain: string; deleted: Record<string, number> }> {
    const existing = await this.prisma.tenants.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tenant not found');

    if (existing.isRoot) {
      throw new BadRequestException(
        'The root community cannot be deleted — it is the host this system answers on.',
      );
    }

    if (existing.status !== 'suspended') {
      throw new BadRequestException(
        'Suspend this community first. Deleting is permanent, so taking it offline is a separate step.',
      );
    }

    if (normalizeTenantDomain(dto.confirmDomain ?? '') !== existing.domain) {
      throw new BadRequestException(
        `Type ${existing.domain} exactly to confirm you are deleting that community.`,
      );
    }

    const deleted: Record<string, number> = {};
    await runUnscoped(`deleting tenant ${existing.domain} and all of its data`, async () => {
      // One transaction, so a failure part-way leaves the community intact
      // rather than half-erased. The timeout is raised well past Prisma's 5s
      // default: this is 29 deletes over what may be years of one community's
      // history, and it runs once in that community's lifetime.
      await this.prisma.$transaction(
        async (tx) => {
          const delegates = tx as unknown as Record<
            TenantScopedModel,
            { deleteMany(args: { where: { tenantId: number } }): Promise<{ count: number }> }
          >;
          for (const model of TENANT_SCOPED_MODELS) {
            const { count } = await delegates[model].deleteMany({ where: { tenantId: id } });
            if (count > 0) deleted[model] = count;
          }
          await (tx as unknown as {
            tenants: { delete(args: { where: { id: number } }): Promise<unknown> };
          }).tenants.delete({ where: { id } });
        },
        { timeout: 120_000, maxWait: 15_000 },
      );
    });

    this.tenantResolution.clearCache();
    // Logged on the ROOT tenant deliberately: audit_log is itself scoped, so a
    // record written against the deleted community would have just been deleted
    // with it. The one trace this leaves has to live somewhere that outlives it.
    await this.auditService.log({
      userId: actorId,
      action: 'tenant.delete',
      entityType: 'tenant',
      entityId: id,
      metadata: { slug: existing.slug, domain: existing.domain, deleted },
    });
    this.logger.warn(
      `Tenant ${existing.domain} (id ${id}) deleted by user ${actorId}. ` +
        `Rows removed: ${JSON.stringify(deleted)}`,
    );

    return { id, domain: existing.domain, deleted };
  }

  /**
   * Sets (or clears) a community's `mail_domain` setting.
   *
   * The same app_config row its own admin edits in Settings -- deliberately one
   * setting reachable from two places, rather than two settings that can
   * disagree. Blank clears the row instead of storing an empty string, because
   * "no row" is what AppConfigService reads as "inherit the deployment's".
   *
   * runUnscoped because the row belongs to the tenant being edited while the
   * request is scoped to the root one.
   */
  private async writeMailDomain(tenantId: number, domain: string, actorId: number): Promise<void> {
    await runUnscoped("setting a tenant's mail domain", async () => {
      if (!domain) {
        await this.prisma.app_config.deleteMany({ where: { tenantId, configKey: 'mail_domain' } });
        return;
      }
      await this.prisma.app_config.upsert({
        where: { tenantId_configKey: { tenantId, configKey: 'mail_domain' } },
        create: {
          tenantId,
          configKey: 'mail_domain',
          configValue: domain,
          description: 'Domain this community sends mail from',
          updatedBy: actorId,
        },
        update: { configValue: domain, updatedBy: actorId },
      });
    });
  }

  private normalizeOrThrow(input: string): string {
    // The same normalisation the Host-header middleware applies, so a tenant
    // created here resolves by exactly the rule that later looks it up.
    const domain = normalizeTenantDomain(input);
    if (!domain || !domain.includes('.')) {
      throw new BadRequestException(`"${input}" is not a usable host.`);
    }
    return domain;
  }

  private assertSlug(slug: string): void {
    if (!/^[a-z0-9-]{1,50}$/.test(slug)) {
      throw new BadRequestException('slug must be 1-50 characters of a-z, 0-9 or "-".');
    }
  }

  /**
   * Turns Prisma's P2002 into a message naming the field that collided.
   *
   * Both `domain` and `slug` are unique, and "Unique constraint failed" alone
   * does not say which -- an operator retyping a domain needs to be told it is
   * taken rather than handed a 500.
   *
   * Matched against the *index names* from schema.prisma rather than
   * `err.meta.target`, which the documented shape would suggest: under
   * `@prisma/adapter-mariadb` there is no `target` at all, and the constraint
   * arrives nested at
   * `meta.driverAdapterError.cause.constraint.index`. Stringifying the whole
   * `meta` and looking for the index name is resilient to that nesting moving
   * again between adapter versions, and the names themselves are pinned by the
   * `@unique(map: ...)` attributes, so they cannot drift silently.
   */
  private translateUniqueViolation(err: unknown, domain: string, slug: string): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const meta = JSON.stringify(err.meta ?? {});
      if (meta.includes('uq_tenant_domain')) {
        return new ConflictException(`${domain} is already in use.`);
      }
      if (meta.includes('uq_tenant_slug')) {
        return new ConflictException(`The slug "${slug}" is already in use.`);
      }
      return new ConflictException('That tenant already exists.');
    }
    return err;
  }
}

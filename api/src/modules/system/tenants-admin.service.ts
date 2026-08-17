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
import { normalizeTenantDomain } from '../../common/utils/tenant-domain.util';
import { EmailStatus, UserRole, UserStatus } from '../../database/enums';
import {
  AUTOMATION_ACCOUNT_EMAIL,
  AUTOMATION_ACCOUNT_NAME,
} from '../../common/utils/service-account.util';
import { AuditService } from '../audit/audit.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
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
    const [events, locations] = await runUnscoped(
      'system admin tenant list reports the size of every tenant',
      async () =>
        await Promise.all([
          this.prisma.events.groupBy({ by: ['tenantId'], _count: { _all: true } }),
          this.prisma.locations.groupBy({ by: ['tenantId'], _count: { _all: true } }),
        ]),
    );

    const eventsByTenant = new Map(events.map((r) => [r.tenantId, r._count._all]));
    const locationsByTenant = new Map(locations.map((r) => [r.tenantId, r._count._all]));

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
    // from the UI is not subtly different from one created by the script. Role
    // `disabled`: it exists to own the rows the deployment writes on that
    // tenant's behalf, not to be signed in as.
    //
    // runUnscoped because the write belongs to the *new* tenant while the
    // request is scoped to the root one -- without the waiver the extension
    // would stamp the root tenant's id onto it.
    const city = await this.prisma.cities.findFirst({ orderBy: { id: 'asc' } });
    if (city) {
      await runUnscoped("creating the new tenant's own service account", async () => {
        await this.prisma.users.create({
          data: {
            tenantId: created.id,
            cityId: city.id,
            fullName: AUTOMATION_ACCOUNT_NAME,
            email: AUTOMATION_ACCOUNT_EMAIL,
            role: UserRole.DISABLED,
            status: UserStatus.ACTIVE,
            emailStatus: EmailStatus.ACTIVE,
            emailVerifiedAt: new Date(),
            isServiceAccount: true,
          },
        });
      });
    } else {
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
    if (mailDomain) {
      await runUnscoped("setting the new tenant's mail domain", async () => {
        await this.prisma.app_config.create({
          data: {
            tenantId: created.id,
            configKey: 'mail_domain',
            configValue: mailDomain,
            description: 'Domain this community sends mail from',
            updatedBy: actorId,
          },
        });
      });
    }

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

    if (Object.keys(data).length === 0) return this.findOne(id);

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
      metadata: { changed: Object.keys(data) },
    });
    return this.findOne(id);
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

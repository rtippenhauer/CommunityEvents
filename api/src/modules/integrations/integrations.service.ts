import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppConfigService } from '../app-config/app-config.service';
import { ApiTokenService, type ApiTokenView, type IssuedToken } from './api-token.service';
import { UserRole, UserStatus } from '../../database/enums';

/**
 * Integration accounts: the non-person accounts an outside app acts as (v2-29).
 *
 * ## "Exactly one non-human account per tenant" is relaxed here
 *
 * CLAUDE.md describes `users.is_service_account` as marking "the one non-human
 * account per tenant". Muse is a second, and nothing ever enforced the
 * singularity -- the column is a plain boolean with no unique index -- so this
 * is a change of wording rather than of structure. It also follows v1's own
 * Phase 39, whose `is_automation_account` comment reads "a non-person account
 * (Claude's automation account, Muse's sync account)".
 *
 * So **the column marks a class and the role says which integration.** That is
 * what gives a Muse account every protection a service account already has,
 * with no new code, because all of them are predicates on the column rather
 * than lookups of one row:
 *
 *  - `assertNotServiceAccount` -- ban, force-ban, admin delete, self-delete
 *  - `EXCLUDE_SERVICE_ACCOUNTS` -- member directory, leaderboard, member search
 *  - `AUTO_DELETE_ELIGIBLE` -- the 120-day sweep and hard delete, which is the
 *    one that would actually have fired: an integration account never logs in,
 *    so it drifts into that window on its own.
 *  - the 60- and 90-day re-engagement nudges, which exclude the column too --
 *    an integration account is not a person to email.
 *
 * ## An address that cannot receive mail
 *
 * `.invalid` is reserved by RFC 2606 and never resolves, so the address can
 * never be mailed even if some future path tries. That is belt-and-braces
 * rather than the protection: the real protection is the column above, which
 * keeps these accounts out of every sweep that sends anything.
 *
 * `password_hash` stays NULL, which is what makes an integration account
 * unable to hold a session at all: login and password reset both refuse a NULL
 * hash, `automationLogin` admits one fixed address, and there is no OAuth link.
 * A token opens only the `/muse` routes and a cookie opens none of them -- so
 * `OperatorGuard`, which grants deployment-operator rights on
 * `is_service_account` alone, is unreachable from here. That is pinned by a
 * test rather than left resting on this comment.
 */
export interface IntegrationAccountView {
  id: number;
  fullName: string;
  email: string;
  role: string;
  status: string;
  createdAt: Date;
  tokens: ApiTokenView[];
}

/** RFC 2606 reserved TLD: guaranteed never to resolve. */
const INTEGRATION_EMAIL_DOMAIN = 'integration.invalid';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: ApiTokenService,
    private readonly audit: AuditService,
    private readonly appConfig: AppConfigService,
  ) {}

  /** What this community currently lets Muse publish. */
  async getMuseSettings(): Promise<{ sharePrivateVenues: boolean }> {
    const value = await this.appConfig.getSiteSetting('muse_share_private_venues');
    return { sharePrivateVenues: value === 'true' };
  }

  /**
   * Opt into (or back out of) publishing a private venue to Facebook.
   *
   * Audited, and deliberately so: this is the switch that decides whether a
   * member's home address and photographs of it leave the site for a public
   * Facebook event. Who turned it on and when is worth being able to answer
   * later -- the same reason a role change is audited and a text setting is
   * not.
   */
  async setMuseSettings(
    sharePrivateVenues: boolean,
    actorId: number,
  ): Promise<{ sharePrivateVenues: boolean }> {
    await this.appConfig.updateConfigValue(
      'muse_share_private_venues',
      sharePrivateVenues ? 'true' : 'false',
      actorId,
    );

    await this.audit.log({
      userId: actorId,
      action: 'integration.muse_private_venues',
      entityType: 'app_config',
      metadata: { sharePrivateVenues },
    });

    return { sharePrivateVenues };
  }

  /**
   * Creates an integration account in the calling admin's own community.
   *
   * The role is fixed at `muse` because that is the only integration there is.
   * It is deliberately *not* a parameter: a create endpoint that accepts a role
   * is one typo away from minting an account with privileges, and the role can
   * be changed afterwards through `setRole`, which refuses anything but the two
   * integration roles for these accounts.
   *
   * `city_id` is NOT NULL on `users` and `cities` is global, so any city serves
   * -- the field is meaningless for an account that attends nothing. Same
   * reasoning as `createServiceAccount`.
   */
  async createAccount(name: string, actorId: number): Promise<IntegrationAccountView> {
    const slug = slugify(name);
    if (slug.length === 0) {
      throw new BadRequestException('Name must contain at least one letter or digit.');
    }

    const email = `${slug}@${INTEGRATION_EMAIL_DOMAIN}`;

    // findFirst, not findUnique: email is unique per *tenant* since v2-6, and
    // the extension injects this community. Two communities may each have a
    // `muse@integration.invalid` and they are different accounts.
    const clash = await this.prisma.users.findFirst({ where: { email } });
    if (clash !== null) {
      throw new BadRequestException(`An account already exists at ${email}.`);
    }

    const city = await this.prisma.cities.findFirst({ select: { id: true } });
    if (city === null) {
      // Seeded reference data, so this means the install never ran seed.js.
      throw new BadRequestException('No cities exist; the deployment is not fully seeded.');
    }

    const created = await this.prisma.users.create({
      data: {
        fullName: name,
        email,
        emailStatus: 'active',
        emailVerifiedAt: new Date(),
        // NULL on purpose -- see the class comment. This is what makes the
        // account unable to hold a session.
        passwordHash: null,
        cityId: city.id,
        role: UserRole.MUSE,
        status: UserStatus.ACTIVE,
        isServiceAccount: true,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });

    await this.audit.log({
      userId: actorId,
      action: 'integration.account_create',
      entityType: 'user',
      entityId: created.id,
      metadata: { email, role: UserRole.MUSE },
    });

    return { ...created, tokens: [] };
  }

  /** Every integration account in this community, with its token history. */
  async listAccounts(): Promise<IntegrationAccountView[]> {
    const accounts = await this.prisma.users.findMany({
      // The class marker plus the two roles only an integration account may
      // hold. Keyed on both so the deployment's own automation account -- which
      // carries the same column -- is listed here too: an admin looking at
      // "integrations" should see every non-person account in their community,
      // not a filtered subset that hides one.
      where: {
        isServiceAccount: true,
        role: { in: [UserRole.MUSE, UserRole.AUTOMATION] },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });

    return Promise.all(
      accounts.map(async (account) => ({
        ...account,
        tokens: await this.tokens.listForUser(account.id),
      })),
    );
  }

  /**
   * Issues a token for an integration account, returning the plaintext once.
   *
   * Refuses any account that is not an integration account, which is the check
   * that matters: a token for an ordinary member's account would be a bearer
   * credential for a human's session-less identity, bypassing every
   * notification preference and consent decision attached to it.
   */
  async issueToken(userId: number, actorId: number): Promise<IssuedToken> {
    const account = await this.requireIntegrationAccount(userId);

    const issued = await this.tokens.issue(account.id, actorId);

    await this.audit.log({
      userId: actorId,
      action: 'integration.token_issue',
      entityType: 'user',
      entityId: account.id,
      // The prefix, never the token. An audit row is read by more people and
      // kept longer than any credential should be.
      metadata: { prefix: issued.prefix, expiresAt: issued.expiresAt.toISOString() },
    });

    return issued;
  }

  async revokeToken(tokenId: number, actorId: number): Promise<void> {
    await this.tokens.revoke(tokenId);

    await this.audit.log({
      userId: actorId,
      action: 'integration.token_revoke',
      entityType: 'api_token',
      entityId: tokenId,
    });
  }

  /**
   * Muse rotating its own credential.
   *
   * Separate from `issueToken` because the actor is the integration itself
   * rather than an admin, so `created_by` is NULL and the audit row records no
   * human. Issuing revokes every other live token, so the old credential dies
   * the moment the new one is returned -- which is the whole point of offering
   * rotation to the integration at all.
   */
  async rotateOwnToken(userId: number): Promise<IssuedToken> {
    const account = await this.requireIntegrationAccount(userId);

    const issued = await this.tokens.issue(account.id, null);

    await this.audit.log({
      userId: account.id,
      action: 'integration.token_rotate',
      entityType: 'user',
      entityId: account.id,
      metadata: { prefix: issued.prefix, expiresAt: issued.expiresAt.toISOString() },
    });

    return issued;
  }

  private async requireIntegrationAccount(
    userId: number,
  ): Promise<{ id: number; role: string }> {
    const account = await this.prisma.users.findFirst({
      where: { id: userId },
      select: { id: true, role: true, isServiceAccount: true },
    });

    if (account === null) throw new NotFoundException('No such account.');

    if (
      !account.isServiceAccount ||
      (account.role !== UserRole.MUSE && account.role !== UserRole.AUTOMATION)
    ) {
      throw new BadRequestException('That account is not an integration account.');
    }

    return { id: account.id, role: account.role };
  }
}

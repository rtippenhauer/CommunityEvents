import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UserRole, UserStatus } from '../../database/enums';
import { EXCLUDE_SERVICE_ACCOUNTS } from '../../common/utils/service-account.util';

/**
 * The Facebook people a community has seen, and the admin's links to members
 * (v2-29).
 *
 * ## Matching is never automatic (rule 5)
 *
 * The server stores every Facebook person it sees and *suggests* members with
 * the same name. It never links anybody, and that is a deliberate refusal
 * rather than a missing feature: a wrong link marks the wrong member Going,
 * emails them a confirmation for a dinner they never chose, and attributes
 * somebody else's +1s to them. Two people called Dave Smith is not a rare case
 * in a community of a few hundred.
 *
 * An admin may link several accounts to one member, since one person can have
 * two Facebook profiles.
 *
 * ## The three statuses answer different questions
 *
 *  - `unmatched` -- nobody has looked at this person yet. The review queue.
 *  - `linked` -- an admin has tied them to a member.
 *  - `not_member` -- an admin has looked and this person has no account here.
 *    **Still counted in the headcount**, just out of the queue. Collapsing this
 *    into `unmatched` would make the queue never empty; collapsing it into
 *    "ignore" would lose a real person from a restaurant booking.
 */
export interface FacebookAccountView {
  id: number;
  profileUrl: string | null;
  facebookUserId: string | null;
  displayName: string;
  status: string;
  userId: number | null;
  memberName: string | null;
  /** Rule 13: a linked member who is banned or deleted is flagged, not hidden. */
  memberIsBannedOrDeleted: boolean;
  linkedAt: Date | null;
  lastSeenAt: Date | null;
  suggestions: { id: number; fullName: string }[];
}

/** What a sync needs back after recording a person it saw. */
export interface UpsertedAccount {
  id: number;
  userId: number | null;
  displayName: string;
  status: string;
}

@Injectable()
export class FacebookAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Records a person seen on a Going list, creating or refreshing their row.
   *
   * Keyed on `facebook_user_id` (rule 4), which is permanent. The vanity
   * `profile_url` is refreshed every sync, and **if another row already holds
   * that vanity it is released to the new holder** -- Facebook lets a vanity be
   * given up and taken by somebody else, so a unique index on it would
   * otherwise fail the whole sync on a name change that is entirely normal.
   *
   * Never changes `status` or `user_id`: a sync observes people, it does not
   * make or unmake links.
   */
  async recordSeen(guest: {
    facebookUserId: string;
    profileUrl: string;
    displayName: string;
  }): Promise<UpsertedAccount> {
    const now = new Date();

    const existing = await this.prisma.facebook_accounts.findFirst({
      where: { facebookUserId: guest.facebookUserId },
      select: { id: true, userId: true, status: true },
    });

    // Release the vanity from whoever else holds it, before we claim it. Scoped
    // by the extension, so this can only ever touch this community's rows.
    const vanityHolder = await this.prisma.facebook_accounts.findFirst({
      where: { profileUrl: guest.profileUrl },
      select: { id: true },
    });
    if (vanityHolder !== null && vanityHolder.id !== existing?.id) {
      await this.prisma.facebook_accounts.updateMany({
        where: { id: vanityHolder.id },
        data: { profileUrl: null },
      });
    }

    if (existing !== null) {
      await this.prisma.facebook_accounts.updateMany({
        where: { id: existing.id },
        data: {
          profileUrl: guest.profileUrl,
          displayName: guest.displayName,
          lastSeenAt: now,
          updatedAt: now,
        },
      });
      return {
        id: existing.id,
        userId: existing.userId,
        displayName: guest.displayName,
        status: existing.status,
      };
    }

    const created = await this.prisma.facebook_accounts.create({
      data: {
        facebookUserId: guest.facebookUserId,
        profileUrl: guest.profileUrl,
        displayName: guest.displayName,
        lastSeenAt: now,
      },
      select: { id: true, userId: true, status: true },
    });

    return {
      id: created.id,
      userId: created.userId,
      displayName: guest.displayName,
      status: created.status,
    };
  }

  /**
   * The admin screen's list, with name suggestions for unmatched rows.
   *
   * Suggestions are an **exact, case-insensitive full-name match** and nothing
   * cleverer. Fuzzy matching here would be a worse failure than no matching:
   * the admin is confirming an identity, and a near-miss presented as a
   * candidate is how the wrong Dave Smith gets linked.
   */
  async list(filter?: 'unmatched' | 'linked' | 'not_member'): Promise<FacebookAccountView[]> {
    const accounts = await this.prisma.facebook_accounts.findMany({
      where: filter === undefined ? {} : { status: filter },
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        profileUrl: true,
        facebookUserId: true,
        displayName: true,
        status: true,
        userId: true,
        linkedAt: true,
        lastSeenAt: true,
        user: { select: { fullName: true, status: true, deletedAt: true } },
      },
    });

    const unmatchedNames = accounts
      .filter((account) => account.userId === null && account.status === 'unmatched')
      .map((account) => account.displayName);

    const candidates =
      unmatchedNames.length === 0
        ? []
        : await this.prisma.users.findMany({
            where: {
              fullName: { in: unmatchedNames },
              status: UserStatus.ACTIVE,
              deletedAt: null,
              // A suggestion must be a person: an integration or service
              // account carries no Facebook identity, and `automation` is not
              // somebody an admin should be invited to link.
              ...EXCLUDE_SERVICE_ACCOUNTS,
              role: { notIn: [UserRole.AUTOMATION, UserRole.MUSE, UserRole.DISABLED] },
            },
            select: { id: true, fullName: true },
          });

    const byName = new Map<string, { id: number; fullName: string }[]>();
    for (const candidate of candidates) {
      const key = candidate.fullName.toLowerCase();
      byName.set(key, [...(byName.get(key) ?? []), candidate]);
    }

    return accounts.map((account) => ({
      id: account.id,
      profileUrl: account.profileUrl,
      facebookUserId: account.facebookUserId,
      displayName: account.displayName,
      status: account.status,
      userId: account.userId,
      memberName: account.user?.fullName ?? null,
      memberIsBannedOrDeleted:
        account.user != null &&
        (account.user.deletedAt != null ||
          account.user.status === UserStatus.SUSPENDED ||
          account.user.status === UserStatus.DELETED),
      linkedAt: account.linkedAt,
      lastSeenAt: account.lastSeenAt,
      suggestions:
        account.userId === null && account.status === 'unmatched'
          ? (byName.get(account.displayName.toLowerCase()) ?? [])
          : [],
    }));
  }

  /** Ties a Facebook account to a member. */
  async link(accountId: number, userId: number, actorId: number): Promise<void> {
    await this.requireAccount(accountId);

    const member = await this.prisma.users.findFirst({
      where: { id: userId, ...EXCLUDE_SERVICE_ACCOUNTS },
      select: { id: true, fullName: true, role: true },
    });
    if (member === null) throw new NotFoundException('No such member.');
    if (member.role === UserRole.AUTOMATION || member.role === UserRole.MUSE) {
      throw new BadRequestException('An integration account cannot be linked to a Facebook person.');
    }

    await this.prisma.facebook_accounts.updateMany({
      where: { id: accountId },
      data: { userId, status: 'linked', linkedAt: new Date(), linkedBy: actorId },
    });

    await this.audit.log({
      userId: actorId,
      action: 'facebook.account_link',
      entityType: 'facebook_account',
      entityId: accountId,
      metadata: { targetUserId: userId, memberName: member.fullName },
    });
  }

  /**
   * Breaks the link, returning the account to the review queue.
   *
   * Deliberately does **not** remove any RSVP the sync created from that link.
   * Unlinking says "this was the wrong person", and the member's RSVP is then
   * either theirs to keep or the admin's to remove explicitly -- silently
   * un-RSVPing somebody because an admin corrected a mapping would drop them
   * from a dinner they may well be attending.
   */
  async unlink(accountId: number, actorId: number): Promise<void> {
    const account = await this.requireAccount(accountId);

    await this.prisma.facebook_accounts.updateMany({
      where: { id: accountId },
      data: { userId: null, status: 'unmatched', linkedAt: null, linkedBy: null },
    });

    await this.audit.log({
      userId: actorId,
      action: 'facebook.account_unlink',
      entityType: 'facebook_account',
      entityId: accountId,
      metadata: { previousUserId: account.userId },
    });
  }

  /** Marks somebody as having no account here: still counted, out of the queue. */
  async markNotAMember(accountId: number, actorId: number): Promise<void> {
    await this.requireAccount(accountId);

    await this.prisma.facebook_accounts.updateMany({
      where: { id: accountId },
      data: { userId: null, status: 'not_member', linkedAt: null, linkedBy: null },
    });

    await this.audit.log({
      userId: actorId,
      action: 'facebook.account_not_member',
      entityType: 'facebook_account',
      entityId: accountId,
    });
  }

  /** Returns a `not_member` or `linked` row to the queue for another look. */
  async markUnmatched(accountId: number, actorId: number): Promise<void> {
    await this.requireAccount(accountId);

    await this.prisma.facebook_accounts.updateMany({
      where: { id: accountId },
      data: { userId: null, status: 'unmatched', linkedAt: null, linkedBy: null },
    });

    await this.audit.log({
      userId: actorId,
      action: 'facebook.account_unmatched',
      entityType: 'facebook_account',
      entityId: accountId,
    });
  }

  /**
   * Marks a Facebook-only attendee as having turned up, or not (v2-29).
   *
   * The attendance dialog's Facebook rows. Tri-state on purpose: `null` is "not
   * marked", which is a different statement from marked no-show -- an
   * unreviewed dinner must not read as a room full of people who did not come.
   *
   * No points or achievements, unlike a member's attendance: those attach to an
   * account, and a Facebook-only person has none. If they are later linked to a
   * member, rule 14 is what turns this history into attended RSVPs through the
   * normal path.
   */
  async markAttendance(
    accountId: number,
    eventId: number,
    attended: boolean | null,
    actorId: number,
  ): Promise<void> {
    await this.requireAccount(accountId);

    const row = await this.prisma.facebook_event_attendees.findFirst({
      where: { eventId, facebookAccountId: accountId },
      select: { id: true },
    });
    if (row === null) {
      throw new NotFoundException('That person is not on this event\'s Facebook lists.');
    }

    await this.prisma.facebook_event_attendees.updateMany({
      where: { id: row.id },
      data: { attended, updatedAt: new Date() },
    });

    await this.audit.log({
      userId: actorId,
      action: 'facebook.attendance_mark',
      entityType: 'event',
      entityId: eventId,
      metadata: { facebookAccountId: accountId, attended },
    });
  }

  /**
   * Every Facebook account linked to one member.
   *
   * The sync needs this because rule 9 merges across a person's *accounts* as
   * well as across lists -- a member with two Facebook profiles on two groups'
   * lists is one person at one table.
   */
  async linkedAccountIdsFor(userId: number): Promise<number[]> {
    const rows = await this.prisma.facebook_accounts.findMany({
      where: { userId },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  private async requireAccount(accountId: number): Promise<{ id: number; userId: number | null }> {
    const account = await this.prisma.facebook_accounts.findFirst({
      where: { id: accountId },
      select: { id: true, userId: true },
    });
    if (account === null) throw new NotFoundException('No such Facebook account.');
    return account;
  }
}

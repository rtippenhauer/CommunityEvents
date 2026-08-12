import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import type { cities as City, event_rsvps as EventRsvp, facebook_group_config as FacebookGroupConfig, invites as Invite, locations as Location, users as User } from '@prisma/client';
import { InviteFlavor, InviteType, RsvpStatus, UserRole } from '../src/database/enums';

describe('Invites (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];

  let city: City;
  let location: Location;
  let admin: User;
  let adminCookie: string;
  let moderatorCookie: string;
  let memberCookie: string;
  let member: User;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    resetThrottler(app);
    city = await seedCity(prisma);
    location = await seedLocation(prisma, city.id);

    admin = await seedUser(prisma, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    const moderator = await seedUser(prisma, city.id, { role: UserRole.MODERATOR, email: 'mod@example.test' });
    member = await seedUser(prisma, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
    adminCookie = await loginAs(app, admin);
    moderatorCookie = await loginAs(app, moderator);
    memberCookie = await loginAs(app, member);
  });

  async function createPublishedEvent(): Promise<{ id: number }> {
    const eventDate = new Date();
    eventDate.setDate(eventDate.getDate() + 14);
    const created = await request(server)
      .post('/api/v1/events')
      .set('Cookie', adminCookie)
      .send({
        cityId: city.id,
        locationId: location.id,
        title: 'Future Dinner',
        eventDate: eventDate.toISOString().slice(0, 10),
        eventTime: '18:30',
      })
      .expect(201);
    await request(server)
      .patch(`/api/v1/events/${created.body.id}`)
      .set('Cookie', adminCookie)
      .send({ status: 'published' })
      .expect(200);
    return created.body;
  }

  describe('POST /invites', () => {
    it('creates a MEMBER invite bound to an email, forcing maxUses to 1 and a 48h expiry', async () => {
      const res = await request(server)
        .post('/api/v1/invites')
        .set('Cookie', adminCookie)
        .send({ type: 'member', boundToEmail: 'invitee@example.test', boundToName: 'Invitee' })
        .expect(201);

      expect(res.body.type).toBe('member');
      expect(res.body.maxUses).toBe(1);

      const expiresAt = new Date(res.body.expiresAt).getTime();
      const expected48h = Date.now() + 48 * 60 * 60 * 1000;
      expect(Math.abs(expiresAt - expected48h)).toBeLessThan(5 * 60 * 1000);
    });

    it('creates an ADMIN invite with a default 30-day expiry when no expiryDays is given', async () => {
      const res = await request(server)
        .post('/api/v1/invites')
        .set('Cookie', adminCookie)
        .send({ type: 'admin' })
        .expect(201);

      expect(res.body.type).toBe('admin');
      const expiresAt = new Date(res.body.expiresAt).getTime();
      const expected30d = Date.now() + 30 * 24 * 60 * 60 * 1000;
      expect(Math.abs(expiresAt - expected30d)).toBeLessThan(5 * 60 * 1000);
    });

    it('creates a CAMPAIGN_FACEBOOK invite tied to a Facebook group', async () => {
      const group = await prisma.facebook_group_config.create({ data: {
        name: 'Test Group',
        url: 'https://facebook.com/groups/test',
        cityId: city.id,
      } });

      const res = await request(server)
        .post('/api/v1/invites')
        .set('Cookie', adminCookie)
        .send({ type: 'campaign_facebook', facebookGroupId: group.id, maxUses: 50, noExpiry: true })
        .expect(201);

      expect(res.body.facebookGroupId).toBe(group.id);
      expect(res.body.maxUses).toBe(50);
      expect(new Date(res.body.expiresAt).getFullYear()).toBe(2099);
    });

    it('forces the invite type to MEMBER for a non-elevated creator regardless of requested type', async () => {
      const res = await request(server)
        .post('/api/v1/invites')
        .set('Cookie', memberCookie)
        .send({ type: 'admin', boundToEmail: 'from-member@example.test' })
        .expect(201);

      expect(res.body.type).toBe('member');
    });

    it('rejects invite creation from a non-validated user', async () => {
      const nonValidated = await seedUser(prisma, city.id, { role: UserRole.NON_VALIDATED, email: 'nv@example.test' });
      const cookie = await loginAs(app, nonValidated);

      await request(server)
        .post('/api/v1/invites')
        .set('Cookie', cookie)
        .send({ type: 'member', boundToEmail: 'x@example.test' })
        .expect(403);
    });

    it('rejects a MEMBER invite with no boundToEmail', async () => {
      await request(server).post('/api/v1/invites').set('Cookie', adminCookie).send({ type: 'member' }).expect(400);
    });

    it('rejects a CAMPAIGN_FACEBOOK invite with no facebookGroupId', async () => {
      await request(server).post('/api/v1/invites').set('Cookie', adminCookie).send({ type: 'campaign_facebook' }).expect(400);
    });

    it('rejects a MEMBER invite for an email that already belongs to an active member', async () => {
      await request(server)
        .post('/api/v1/invites')
        .set('Cookie', adminCookie)
        .send({ type: 'member', boundToEmail: 'member@example.test' })
        .expect(400);
    });

    it('rejects a duplicate pending MEMBER invite for the same email', async () => {
      await request(server)
        .post('/api/v1/invites')
        .set('Cookie', adminCookie)
        .send({ type: 'member', boundToEmail: 'dup@example.test' })
        .expect(201);

      await request(server)
        .post('/api/v1/invites')
        .set('Cookie', adminCookie)
        .send({ type: 'member', boundToEmail: 'dup@example.test' })
        .expect(400);
    });

    it('rejects an invalid invite type', async () => {
      await request(server)
        .post('/api/v1/invites')
        .set('Cookie', adminCookie)
        .send({ type: 'guest_rsvp' })
        .expect(400);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).post('/api/v1/invites').send({ type: 'member', boundToEmail: 'x@example.test' }).expect(401);
    });

    it('normalizes boundToEmail to lowercase even when submitted mixed-case', async () => {
      const res = await request(server)
        .post('/api/v1/invites')
        .set('Cookie', adminCookie)
        .send({ type: 'member', boundToEmail: 'MixedCase@Example.test', boundToName: 'Mixed Case' })
        .expect(201);
      expect(res.body.boundToEmail).toBe('mixedcase@example.test');
    });

    it('lets a member register whose email case differs from the mixed-case invite it was sent to', async () => {
      const created = await request(server)
        .post('/api/v1/invites')
        .set('Cookie', adminCookie)
        .send({ type: 'member', boundToEmail: 'MixedCase@Example.test', boundToName: 'Mixed Case' })
        .expect(201);

      await request(server)
        .post('/api/v1/auth/register')
        .send({
          inviteToken: created.body.token,
          fullName: 'Mixed Case',
          email: 'mixedcase@example.test',
          password: 'MixedCasePassword123!',
        })
        .expect(201);
    });

    it('validates a pre-existing invite whose boundToEmail was stored mixed-case (pre-fix data) against a lowercase registration email', async () => {
      // Simulates an invite row created before boundToEmail normalization existed —
      // the defensive lowercase compare in validate() must still accept it rather
      // than requiring a data migration to fix already-sent invites.
      const invite = await prisma.invites.create({ data: {
          token: `legacy-mixed-case-${Date.now()}`,
          type: InviteType.MEMBER,
          createdBy: admin.id,
          boundToEmail: 'LegacyMixedCase@Example.test',
          boundToName: 'Legacy Mixed Case',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          maxUses: 1,
          useCount: 0,
        }, });

      await request(server)
        .post('/api/v1/auth/register')
        .send({
          inviteToken: invite.token,
          fullName: 'Legacy Mixed Case',
          email: 'legacymixedcase@example.test',
          password: 'LegacyMixedPassword123!',
        })
        .expect(201);
    });
  });

  describe('GET /invites/mine', () => {
    it("lists only the current user's invites", async () => {
      await request(server)
        .post('/api/v1/invites')
        .set('Cookie', adminCookie)
        .send({ type: 'member', boundToEmail: 'mine@example.test' })
        .expect(201);
      await request(server)
        .post('/api/v1/invites')
        .set('Cookie', memberCookie)
        .send({ type: 'member', boundToEmail: 'not-mine@example.test' })
        .expect(201);

      const res = await request(server).get('/api/v1/invites/mine').set('Cookie', adminCookie).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].boundToEmail).toBe('mine@example.test');
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).get('/api/v1/invites/mine').expect(401);
    });
  });

  describe('GET /invites (admin only)', () => {
    it('lists every invite for an admin', async () => {
      await request(server)
        .post('/api/v1/invites')
        .set('Cookie', memberCookie)
        .send({ type: 'member', boundToEmail: 'anyone@example.test' })
        .expect(201);

      const res = await request(server).get('/api/v1/invites').set('Cookie', adminCookie).expect(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects a moderator (admin-only)', async () => {
      await request(server).get('/api/v1/invites').set('Cookie', moderatorCookie).expect(403);
    });

    it('rejects a member', async () => {
      await request(server).get('/api/v1/invites').set('Cookie', memberCookie).expect(403);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).get('/api/v1/invites').expect(401);
    });
  });

  describe('PATCH /invites/:id/revoke (admin only)', () => {
    it('revokes any invite as admin', async () => {
      const created = await request(server)
        .post('/api/v1/invites')
        .set('Cookie', memberCookie)
        .send({ type: 'member', boundToEmail: 'revoke-me@example.test' })
        .expect(201);

      await request(server).patch(`/api/v1/invites/${created.body.id}/revoke`).set('Cookie', adminCookie).expect(200);

      const invite = await prisma.invites.findFirst({ where: { id: created.body.id } });
      expect(invite!.isRevoked).toBe(true);
    });

    it('rejects a moderator (admin-only)', async () => {
      const created = await request(server)
        .post('/api/v1/invites')
        .set('Cookie', memberCookie)
        .send({ type: 'member', boundToEmail: 'revoke-mod@example.test' })
        .expect(201);

      await request(server).patch(`/api/v1/invites/${created.body.id}/revoke`).set('Cookie', moderatorCookie).expect(403);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).patch('/api/v1/invites/1/revoke').expect(401);
    });
  });

  describe('PATCH /invites/:id/revoke-own', () => {
    it('lets the creator revoke their own unredeemed invite', async () => {
      const created = await request(server)
        .post('/api/v1/invites')
        .set('Cookie', memberCookie)
        .send({ type: 'member', boundToEmail: 'own-revoke@example.test' })
        .expect(201);

      await request(server).patch(`/api/v1/invites/${created.body.id}/revoke-own`).set('Cookie', memberCookie).expect(200);

      const invite = await prisma.invites.findFirst({ where: { id: created.body.id } });
      expect(invite!.isRevoked).toBe(true);
    });

    it("rejects revoking someone else's invite", async () => {
      const created = await request(server)
        .post('/api/v1/invites')
        .set('Cookie', adminCookie)
        .send({ type: 'member', boundToEmail: 'someone-elses@example.test' })
        .expect(201);

      await request(server).patch(`/api/v1/invites/${created.body.id}/revoke-own`).set('Cookie', memberCookie).expect(403);
    });

    it('rejects revoking an already-redeemed invite', async () => {
      const created = await request(server)
        .post('/api/v1/invites')
        .set('Cookie', memberCookie)
        .send({ type: 'member', boundToEmail: 'already-redeemed@example.test' })
        .expect(201);
      await prisma.invites
        .update({ where: { id: created.body.id }, data: { redeemedAt: new Date(), redeemedBy: member.id, useCount: 1 } });

      await request(server).patch(`/api/v1/invites/${created.body.id}/revoke-own`).set('Cookie', memberCookie).expect(400);
    });

    it('returns 404 for a nonexistent invite', async () => {
      await request(server).patch('/api/v1/invites/999999/revoke-own').set('Cookie', memberCookie).expect(404);
    });
  });

  describe('GET /invites/preview/:token (public)', () => {
    it('previews an event invite with full/expired/revoked flags', async () => {
      const event = await createPublishedEvent();
      const created = await request(server)
        .post(`/api/v1/events/${event.id}/invite-links`)
        .set('Cookie', adminCookie)
        .send({ flavor: 'non_validated' })
        .expect(201);

      const res = await request(server).get(`/api/v1/invites/preview/${created.body.token}`).expect(200);
      expect(res.body.isFull).toBe(false);
      expect(res.body.isExpired).toBe(false);
      expect(res.body.isRevoked).toBe(false);
      expect(res.body.event.id).toBe(event.id);
    });

    it('returns 404 for a non-event-invite token', async () => {
      const created = await request(server)
        .post('/api/v1/invites')
        .set('Cookie', adminCookie)
        .send({ type: 'member', boundToEmail: 'preview-member@example.test' })
        .expect(201);

      const invite = await prisma.invites.findFirst({ where: { id: created.body.id } });
      await request(server).get(`/api/v1/invites/preview/${invite!.token}`).expect(404);
    });

    it('returns 404 for an unknown token', async () => {
      await request(server).get('/api/v1/invites/preview/nonexistent-token').expect(404);
    });
  });

  describe('Event-scoped invite links (via /events/:id/invite-links)', () => {
    it('creates an event invite link with a fixed 10-use cap and RSVP-cutoff expiry', async () => {
      const event = await createPublishedEvent();

      const res = await request(server)
        .post(`/api/v1/events/${event.id}/invite-links`)
        .set('Cookie', adminCookie)
        .send({ flavor: 'member' })
        .expect(201);

      expect(res.body.type).toBe('event_invite');
      expect(res.body.inviteFlavor).toBe('member');
      expect(res.body.maxUses).toBe(10);
      expect(res.body.eventId).toBe(event.id);
    });

    it('lists event invite links for admin and moderator', async () => {
      const event = await createPublishedEvent();
      await request(server)
        .post(`/api/v1/events/${event.id}/invite-links`)
        .set('Cookie', adminCookie)
        .send({ flavor: 'non_validated' })
        .expect(201);

      const asAdmin = await request(server).get(`/api/v1/events/${event.id}/invite-links`).set('Cookie', adminCookie).expect(200);
      expect(asAdmin.body).toHaveLength(1);

      await request(server).get(`/api/v1/events/${event.id}/invite-links`).set('Cookie', moderatorCookie).expect(200);
    });

    it('rejects a moderator creating an event invite link (admin-only)', async () => {
      const event = await createPublishedEvent();
      await request(server)
        .post(`/api/v1/events/${event.id}/invite-links`)
        .set('Cookie', moderatorCookie)
        .send({ flavor: 'non_validated' })
        .expect(403);
    });

    it('rejects a member listing or creating event invite links', async () => {
      const event = await createPublishedEvent();
      await request(server).get(`/api/v1/events/${event.id}/invite-links`).set('Cookie', memberCookie).expect(403);
      await request(server)
        .post(`/api/v1/events/${event.id}/invite-links`)
        .set('Cookie', memberCookie)
        .send({ flavor: 'non_validated' })
        .expect(403);
    });

    it('revokes an event invite link as admin', async () => {
      const event = await createPublishedEvent();
      const created = await request(server)
        .post(`/api/v1/events/${event.id}/invite-links`)
        .set('Cookie', adminCookie)
        .send({ flavor: 'non_validated' })
        .expect(201);

      await request(server)
        .patch(`/api/v1/events/${event.id}/invite-links/${created.body.id}/revoke`)
        .set('Cookie', adminCookie)
        .expect(200);

      const invite = await prisma.invites.findFirst({ where: { id: created.body.id } });
      expect(invite!.isRevoked).toBe(true);
    });
  });

  describe('Redeeming an event invite via registration', () => {
    it('registers as NON_VALIDATED and auto-creates a Going RSVP for the event', async () => {
      const event = await createPublishedEvent();
      const invite = await prisma.invites.create({ data: {
          token: `evt-invite-${Date.now()}`,
          type: InviteType.EVENT_INVITE,
          createdBy: admin.id,
          eventId: event.id,
          inviteFlavor: InviteFlavor.NON_VALIDATED,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          maxUses: 10,
          useCount: 0,
        }, });

      await request(server)
        .post('/api/v1/auth/register')
        .send({
          inviteToken: invite.token,
          fullName: 'Walk In',
          email: 'walkin@example.test',
          password: 'WalkInPassword123!',
        })
        .expect(201);

      const newUser = await prisma.users.findFirst({ where: { email: 'walkin@example.test' } });
      expect(newUser!.role).toBe(UserRole.NON_VALIDATED);

      const rsvp = await prisma.event_rsvps.findFirst({ where: { userId: newUser!.id, eventId: event.id } });
      expect(rsvp).toBeTruthy();
      expect(rsvp!.status).toBe(RsvpStatus.GOING);

      const updatedInvite = await prisma.invites.findFirst({ where: { id: invite.id } });
      expect(updatedInvite!.useCount).toBe(1);
    });
  });

  describe('GET /admin/invites/lineage (admin only)', () => {
    it('builds a tree of members by who invited whom', async () => {
      const invitee = await seedUser(prisma, city.id, {
        email: 'invitee-lineage@example.test',
        invitedBy: member.id,
      });

      const res = await request(server).get('/api/v1/admin/invites/lineage').set('Cookie', adminCookie).expect(200);
      const memberNode = res.body.find((n: { id: number }) => n.id === member.id);
      expect(memberNode).toBeTruthy();
      expect(memberNode.invitedMembers.some((n: { id: number }) => n.id === invitee.id)).toBe(true);
    });

    it('rejects a moderator (admin-only)', async () => {
      await request(server).get('/api/v1/admin/invites/lineage').set('Cookie', moderatorCookie).expect(403);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).get('/api/v1/admin/invites/lineage').expect(401);
    });
  });
});

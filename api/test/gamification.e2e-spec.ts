import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedRestaurant, seedUser, loginAs } from './utils/seed';
import { CityEntity } from '../src/database/entities/city.entity';
import { RestaurantEntity } from '../src/database/entities/restaurant.entity';
import { UserEntity, UserRole } from '../src/database/entities/user.entity';
import { EventEntity } from '../src/database/entities/event.entity';
import { MemberAchievementEntity } from '../src/database/entities/member-achievement.entity';
import { MemberPointEntity, PointType } from '../src/database/entities/member-point.entity';
import { AchievementEntity } from '../src/database/entities/achievement.entity';
import { PointsService } from '../src/modules/community/points.service';
import { AchievementsService } from '../src/modules/community/achievements.service';

describe('Gamification: Achievements, Points, Leaderboard (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: Parameters<typeof request>[0];
  let pointsService: PointsService;
  let achievementsService: AchievementsService;

  let city: CityEntity;
  let restaurant: RestaurantEntity;
  let admin: UserEntity;
  let adminCookie: string;
  let moderatorCookie: string;
  let member: UserEntity;
  let memberCookie: string;

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
    server = app.getHttpServer();
    pointsService = app.get(PointsService);
    achievementsService = app.get(AchievementsService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    resetThrottler(app);
    city = await seedCity(dataSource);
    restaurant = await seedRestaurant(dataSource, city.id);

    admin = await seedUser(dataSource, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    const moderator = await seedUser(dataSource, city.id, { role: UserRole.MODERATOR, email: 'mod@example.test' });
    member = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
    adminCookie = await loginAs(app, admin);
    moderatorCookie = await loginAs(app, moderator);
    memberCookie = await loginAs(app, member);

    // The real achievement catalog is seed data inserted once by migrations at app
    // boot, not per-test fixture data — but truncateAllTables (shared with every
    // other spec file, several of which rely on a clean slate for their own
    // achievement CRUD tests) wipes it along with everything else. Re-seed just
    // the keys this spec exercises so grant() has something to find.
    const achievementRepo = dataSource.getRepository(AchievementEntity);
    await achievementRepo.save([
      { key: 'first_dinner', name: 'First Dinner', description: 'd', points: 3 },
      { key: 'regular', name: 'Regular', description: 'd', points: 1, title: 'Regular' },
      { key: 'veteran', name: 'Veteran', description: 'd', points: 1, title: 'Veteran' },
      { key: 'first_coordinator', name: 'First Coordinator', description: 'd', points: 0 },
      { key: 'scout', name: 'Scout', description: 'd', points: 1, title: 'Scout' },
      { key: 'first_review', name: 'First Review', description: 'd', points: 0 },
      { key: 'critic', name: 'Critic', description: 'd', points: 1 },
      { key: 'connector', name: 'Connector', description: 'd', points: 0 },
      { key: 'city_hopper_1', name: 'City Hopper', description: 'd', points: 1 },
      { key: 'secret_dinner_1', name: 'Secret Dinner', description: 'd', points: 1 },
      { key: 'login_25', name: 'Familiar Face', description: 'd', points: 10 },
      { key: 'patriotic_bear', name: 'Patriotic Bear', description: 'd', points: 10, isSecret: true },
      { key: 'founding_bear', name: 'Founding Bear', description: 'd', points: 0, title: 'Founding Bear' },
    ]);
  });

  async function hasEarned(userId: number, key: string): Promise<boolean> {
    return achievementsService.hasEarned(userId, key);
  }

  async function seedEvent(overrides: Record<string, unknown> = {}): Promise<EventEntity> {
    const repo = dataSource.getRepository(EventEntity);
    return repo.save(
      repo.create({
        cityId: city.id,
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        restaurantAddress: restaurant.address,
        createdById: admin.id,
        title: 'Gamification Test Dinner',
        eventDate: '2027-01-05',
        eventTime: '18:30',
        ...overrides,
      }),
    );
  }

  describe('Attendance achievement tiers', () => {
    it('grants first_dinner on the first attendance point and regular on the fifth', async () => {
      for (let i = 0; i < 5; i += 1) {
        const event = await seedEvent({ title: `Dinner ${i}` });
        await pointsService.awardAttendance(member.id, event.id);
      }

      expect(await hasEarned(member.id, 'first_dinner')).toBe(true);
      expect(await hasEarned(member.id, 'regular')).toBe(true);
      expect(await hasEarned(member.id, 'veteran')).toBe(false);
    });

    it('is idempotent — awarding attendance twice for the same event does not double-count', async () => {
      const event = await seedEvent();
      await pointsService.awardAttendance(member.id, event.id);
      await pointsService.awardAttendance(member.id, event.id);

      const count = await dataSource
        .getRepository(MemberPointEntity)
        .count({ where: { userId: member.id, pointType: PointType.ATTENDANCE } });
      expect(count).toBe(1);
    });
  });

  describe('Coordinator achievement tiers', () => {
    it('grants first_coordinator and scout after coordinating at a brand-new restaurant', async () => {
      const event = await seedEvent();
      await pointsService.awardCoordinator(member.id, event.id);

      const points = await dataSource
        .getRepository(MemberPointEntity)
        .findOne({ where: { userId: member.id, pointType: PointType.COORDINATOR_NEW_RESTAURANT, referenceId: event.id } });
      expect(points!.points).toBe(4);
      expect(await hasEarned(member.id, 'first_coordinator')).toBe(true);
      expect(await hasEarned(member.id, 'scout')).toBe(true);
    });

    it('grants only the base coordinator credit at an established restaurant', async () => {
      await dataSource.query('UPDATE restaurants SET created_at = ? WHERE id = ?', [
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        restaurant.id,
      ]);
      const event = await seedEvent();
      await pointsService.awardCoordinator(member.id, event.id);

      const points = await dataSource
        .getRepository(MemberPointEntity)
        .findOne({ where: { userId: member.id, pointType: PointType.COORDINATOR, referenceId: event.id } });
      expect(points!.points).toBe(2);
      expect(await hasEarned(member.id, 'scout')).toBe(false);
    });
  });

  describe('Rating achievement tiers', () => {
    it('grants first_review and critic after 5 ratings', async () => {
      const restaurants = await Promise.all(
        Array.from({ length: 5 }, (_, i) => seedRestaurant(dataSource, city.id, { name: `Rated Restaurant ${i}` })),
      );
      for (const r of restaurants) {
        await pointsService.awardRating(member.id, r.id);
      }

      expect(await hasEarned(member.id, 'first_review')).toBe(true);
      expect(await hasEarned(member.id, 'critic')).toBe(true);
    });
  });

  describe('Invite achievement (first successful invite)', () => {
    it("awards the inviter a point and 'connector' when their invitee's first attendance is recorded", async () => {
      const inviter = await seedUser(dataSource, city.id, { email: 'inviter@example.test' });
      const invitee = await seedUser(dataSource, city.id, { email: 'invitee@example.test', invitedBy: inviter.id });
      const event = await seedEvent();

      await pointsService.awardAttendance(invitee.id, event.id);

      const invitePoint = await dataSource
        .getRepository(MemberPointEntity)
        .findOne({ where: { userId: inviter.id, pointType: PointType.INVITE, referenceId: invitee.id } });
      expect(invitePoint).toBeTruthy();
      expect(await hasEarned(inviter.id, 'connector')).toBe(true);
    });

    it("does not award an invite point for the invitee's second attended dinner", async () => {
      const inviter = await seedUser(dataSource, city.id, { email: 'inviter2@example.test' });
      const invitee = await seedUser(dataSource, city.id, { email: 'invitee2@example.test', invitedBy: inviter.id });
      const event1 = await seedEvent({ title: 'First' });
      const event2 = await seedEvent({ title: 'Second' });

      await pointsService.awardAttendance(invitee.id, event1.id);
      await pointsService.awardAttendance(invitee.id, event2.id);

      const inviteCount = await dataSource
        .getRepository(MemberPointEntity)
        .count({ where: { userId: inviter.id, pointType: PointType.INVITE } });
      expect(inviteCount).toBe(1);
    });
  });

  describe('City-hopper and secret-dinner achievement tiers', () => {
    it('grants city_hopper_1 on the first city-hopper point', async () => {
      const event = await seedEvent();
      await pointsService.awardCityHopper(member.id, event.id);
      expect(await hasEarned(member.id, 'city_hopper_1')).toBe(true);
      expect(await hasEarned(member.id, 'city_hopper_3')).toBe(false);
    });

    it('grants secret_dinner_1 on the first secret-dinner point', async () => {
      const event = await seedEvent();
      await pointsService.awardSecretDinner(member.id, event.id);
      expect(await hasEarned(member.id, 'secret_dinner_1')).toBe(true);
    });
  });

  describe('Login and Patriotic Bear achievements', () => {
    it('grants login_25 once the qualifying login count reaches 25', async () => {
      await achievementsService.checkLoginAchievements(member.id, 25);
      expect(await hasEarned(member.id, 'login_25')).toBe(true);
      expect(await hasEarned(member.id, 'login_50')).toBe(false);
    });

    it('grants patriotic_bear when logging in during the qualifying window', async () => {
      await achievementsService.checkPatrioticBearAchievement(member.id, new Date('2026-07-05T12:00:00Z'));
      expect(await hasEarned(member.id, 'patriotic_bear')).toBe(true);
    });

    it('does not grant patriotic_bear outside the qualifying window', async () => {
      await achievementsService.checkPatrioticBearAchievement(member.id, new Date('2026-01-01T12:00:00Z'));
      expect(await hasEarned(member.id, 'patriotic_bear')).toBe(false);
    });
  });

  describe('Event-specific one-time achievement', () => {
    it('creates and grants an event-specific achievement on attendance', async () => {
      const event = await seedEvent();
      const created = await request(server)
        .post(`/api/v1/admin/events/${event.id}/achievement`)
        .set('Cookie', adminCookie)
        .send({ name: 'Special Dinner', description: 'Attended a special one-off event', points: 5 })
        .expect(201);
      expect(created.body.eventId).toBe(event.id);

      await achievementsService.checkEventAchievement(member.id, event.id);

      const earned = await dataSource
        .getRepository(MemberAchievementEntity)
        .findOne({ where: { memberId: member.id, achievementId: created.body.id } });
      expect(earned).toBeTruthy();
    });
  });

  describe('Title selection: PATCH /members/me/title', () => {
    it('lets a member select a title from an earned achievement', async () => {
      for (let i = 0; i < 5; i += 1) {
        const event = await seedEvent({ title: `Title Dinner ${i}` });
        await pointsService.awardAttendance(member.id, event.id);
      }

      await request(server).patch('/api/v1/members/me/title').set('Cookie', memberCookie).send({ title: 'Regular' }).expect(200);

      const user = await dataSource.getRepository(UserEntity).findOne({ where: { id: member.id } });
      expect(user!.selectedTitle).toBe('Regular');
    });

    it('rejects selecting a title the member has not earned', async () => {
      await request(server).patch('/api/v1/members/me/title').set('Cookie', memberCookie).send({ title: 'Veteran' }).expect(400);
    });

    it('clears the title when null is sent', async () => {
      for (let i = 0; i < 5; i += 1) {
        const event = await seedEvent({ title: `Clear Dinner ${i}` });
        await pointsService.awardAttendance(member.id, event.id);
      }
      await request(server).patch('/api/v1/members/me/title').set('Cookie', memberCookie).send({ title: 'Regular' }).expect(200);

      await request(server).patch('/api/v1/members/me/title').set('Cookie', memberCookie).send({ title: null }).expect(200);

      const user = await dataSource.getRepository(UserEntity).findOne({ where: { id: member.id } });
      expect(user!.selectedTitle).toBeNull();
    });
  });

  describe('Admin achievement grant/revoke', () => {
    it('grants an achievement to a member directly, bypassing progress checks', async () => {
      await request(server)
        .patch(`/api/v1/admin/members/${member.id}/achievements/grant`)
        .set('Cookie', adminCookie)
        .send({ key: 'veteran' })
        .expect(200);

      expect(await hasEarned(member.id, 'veteran')).toBe(true);
    });

    it('rejects a moderator granting an achievement (admin-only)', async () => {
      await request(server)
        .patch(`/api/v1/admin/members/${member.id}/achievements/grant`)
        .set('Cookie', moderatorCookie)
        .send({ key: 'veteran' })
        .expect(403);
    });

    it('revokes an achievement without clawing back already-awarded points', async () => {
      // awardAttendance auto-grants 'first_dinner' (via checkAttendanceAchievements),
      // which — since its seeded points value is > 0 above — also creates the
      // member_points ACHIEVEMENT row we're asserting survives the revoke.
      await pointsService.awardAttendance(member.id, (await seedEvent()).id);
      const achievement = await dataSource.getRepository(AchievementEntity).findOne({ where: { key: 'first_dinner' } });
      expect(await hasEarned(member.id, 'first_dinner')).toBe(true);

      await request(server)
        .patch(`/api/v1/admin/members/${member.id}/achievements/${achievement!.id}/revoke`)
        .set('Cookie', adminCookie)
        .expect(200);

      const memberAchievement = await dataSource
        .getRepository(MemberAchievementEntity)
        .findOne({ where: { memberId: member.id, achievementId: achievement!.id } });
      expect(memberAchievement).toBeNull();
      const achievementPoints = await dataSource
        .getRepository(MemberPointEntity)
        .findOne({ where: { userId: member.id, pointType: PointType.ACHIEVEMENT, referenceId: achievement!.id } });
      expect(achievementPoints).toBeTruthy();
    });

    it('rejects a moderator revoking an achievement (admin-only)', async () => {
      const achievement = await dataSource.getRepository(AchievementEntity).findOne({ where: { key: 'first_dinner' } });
      await request(server)
        .patch(`/api/v1/admin/members/${member.id}/achievements/${achievement!.id}/revoke`)
        .set('Cookie', moderatorCookie)
        .expect(403);
    });
  });

  describe('Points ledger admin endpoints', () => {
    it('lists a member\'s point ledger for admin and moderator', async () => {
      await pointsService.awardAttendance(member.id, (await seedEvent()).id);

      const asAdmin = await request(server)
        .get(`/api/v1/admin/members/${member.id}/points/ledger`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(asAdmin.body.length).toBeGreaterThanOrEqual(1);

      await request(server).get(`/api/v1/admin/members/${member.id}/points/ledger`).set('Cookie', moderatorCookie).expect(200);
    });

    it('rejects a member reading the points ledger', async () => {
      await request(server).get(`/api/v1/admin/members/${member.id}/points/ledger`).set('Cookie', memberCookie).expect(403);
    });

    it('removes a point entry as admin', async () => {
      await pointsService.awardAttendance(member.id, (await seedEvent()).id);
      const point = await dataSource.getRepository(MemberPointEntity).findOne({ where: { userId: member.id } });

      await request(server).patch(`/api/v1/admin/points/${point!.id}/remove`).set('Cookie', adminCookie).expect(200);

      const removed = await dataSource.getRepository(MemberPointEntity).findOne({ where: { id: point!.id } });
      expect(removed).toBeNull();
    });

    it('no-ops removing a nonexistent point entry rather than erroring', async () => {
      await request(server).patch('/api/v1/admin/points/999999/remove').set('Cookie', adminCookie).expect(200);
    });

    it('rejects a moderator removing a point entry (admin-only)', async () => {
      await pointsService.awardAttendance(member.id, (await seedEvent()).id);
      const point = await dataSource.getRepository(MemberPointEntity).findOne({ where: { userId: member.id } });
      await request(server).patch(`/api/v1/admin/points/${point!.id}/remove`).set('Cookie', moderatorCookie).expect(403);
    });
  });

  describe('Admin: backfill founders + recalculate points', () => {
    it('backfills founding_bear for active members missing it', async () => {
      await request(server).post('/api/v1/admin/achievements/backfill-founders').set('Cookie', adminCookie).expect(201);
      expect(await hasEarned(member.id, 'founding_bear')).toBe(true);
    });

    it('rejects a moderator running the founders backfill (admin-only)', async () => {
      await request(server).post('/api/v1/admin/achievements/backfill-founders').set('Cookie', moderatorCookie).expect(403);
    });

    it('recalculates the achievement points ledger', async () => {
      const res = await request(server)
        .post('/api/v1/admin/achievements/recalculate-points')
        .set('Cookie', adminCookie)
        .expect(201);
      expect(res.body).toEqual(expect.objectContaining({ updated: expect.any(Number), inserted: expect.any(Number) }));
    });

    it('backfills missing invite points and achievements for an attendee whose inviter was never credited', async () => {
      const inviter = await seedUser(dataSource, city.id, { email: 'backfill-inviter@example.test' });
      const invitee = await seedUser(dataSource, city.id, { email: 'backfill-invitee@example.test', invitedBy: inviter.id });
      // Simulate the pre-fix bug: the invitee attended (their first dinner), but no
      // invite point was ever recorded for the inviter, since checkInvitePointForInviter
      // silently failed before this phase's fix.
      await dataSource
        .getRepository(MemberPointEntity)
        .save({ userId: invitee.id, pointType: PointType.ATTENDANCE, referenceId: (await seedEvent()).id, points: 1 });

      const res = await request(server)
        .post('/api/v1/admin/achievements/backfill-invites')
        .set('Cookie', adminCookie)
        .expect(201);
      expect(res.body.pointsGranted).toBe(1);

      const invitePoint = await dataSource
        .getRepository(MemberPointEntity)
        .findOne({ where: { userId: inviter.id, pointType: PointType.INVITE, referenceId: invitee.id } });
      expect(invitePoint).toBeTruthy();
      expect(await hasEarned(inviter.id, 'connector')).toBe(true);

      // Backfilled achievements are marked already-seen so they don't trigger a
      // splash popup for activity that actually happened before this phase.
      const achievement = await dataSource.getRepository(AchievementEntity).findOne({ where: { key: 'connector' } });
      const memberAchievement = await dataSource
        .getRepository(MemberAchievementEntity)
        .findOne({ where: { memberId: inviter.id, achievementId: achievement!.id } });
      expect(memberAchievement!.seenAt).toBeTruthy();
    });

    it('is idempotent — running the invite-points backfill twice does not double-award', async () => {
      const inviter = await seedUser(dataSource, city.id, { email: 'idempotent-inviter@example.test' });
      const invitee = await seedUser(dataSource, city.id, { email: 'idempotent-invitee@example.test', invitedBy: inviter.id });
      await dataSource
        .getRepository(MemberPointEntity)
        .save({ userId: invitee.id, pointType: PointType.ATTENDANCE, referenceId: (await seedEvent()).id, points: 1 });

      await request(server).post('/api/v1/admin/achievements/backfill-invites').set('Cookie', adminCookie).expect(201);
      const second = await request(server).post('/api/v1/admin/achievements/backfill-invites').set('Cookie', adminCookie).expect(201);

      expect(second.body.pointsGranted).toBe(0);
      const count = await dataSource
        .getRepository(MemberPointEntity)
        .count({ where: { userId: inviter.id, pointType: PointType.INVITE, referenceId: invitee.id } });
      expect(count).toBe(1);
    });

    it('rejects a moderator running the invite-points backfill (admin-only)', async () => {
      await request(server).post('/api/v1/admin/achievements/backfill-invites').set('Cookie', moderatorCookie).expect(403);
    });
  });

  describe('GET /leaderboard', () => {
    it('rejects unauthenticated requests', async () => {
      await request(server).get('/api/v1/leaderboard').expect(401);
    });

    it('rejects a non-validated member (not in the allowed role list)', async () => {
      const nonValidated = await seedUser(dataSource, city.id, { role: UserRole.NON_VALIDATED, email: 'nv@example.test' });
      const cookie = await loginAs(app, nonValidated);
      await request(server).get('/api/v1/leaderboard').set('Cookie', cookie).expect(403);
    });

    it('ranks members by total points and excludes admins from the ranking', async () => {
      await pointsService.awardAttendance(member.id, (await seedEvent()).id);
      // Give the admin account points too, to confirm it's filtered out of the rankings
      await dataSource
        .getRepository(MemberPointEntity)
        .save({ userId: admin.id, pointType: PointType.ATTENDANCE, referenceId: 999999, points: 10 });

      const res = await request(server).get('/api/v1/leaderboard').set('Cookie', memberCookie).expect(200);
      expect(res.body.some((e: { userId: number }) => e.userId === member.id)).toBe(true);
      expect(res.body.some((e: { userId: number }) => e.userId === admin.id)).toBe(false);
    });

    it('includes moderators in the ranking', async () => {
      const moderator = await dataSource.getRepository(UserEntity).findOne({ where: { role: UserRole.MODERATOR } });
      const res = await request(server).get('/api/v1/leaderboard').set('Cookie', memberCookie).expect(200);
      expect(res.body.some((e: { userId: number }) => e.userId === moderator!.id)).toBe(true);
    });

    it('filters by cityId when provided', async () => {
      const otherCity = await seedCity(dataSource);
      const otherMember = await seedUser(dataSource, otherCity.id, { email: 'other-city@example.test' });

      const res = await request(server)
        .get('/api/v1/leaderboard')
        .query({ cityId: city.id })
        .set('Cookie', memberCookie)
        .expect(200);
      expect(res.body.some((e: { userId: number }) => e.userId === otherMember.id)).toBe(false);
      expect(res.body.every((e: { cityId: number }) => e.cityId === city.id)).toBe(true);
    });

    it('ignores a non-numeric cityId rather than erroring', async () => {
      const res = await request(server)
        .get('/api/v1/leaderboard')
        .query({ cityId: 'not-a-number' })
        .set('Cookie', memberCookie)
        .expect(200);
      expect(res.body.some((e: { userId: number }) => e.userId === member.id)).toBe(true);
    });
  });

  describe('GET /members/me/points, /members/:id/points, /members/:id/achievements', () => {
    it("returns the caller's point summary", async () => {
      await pointsService.awardAttendance(member.id, (await seedEvent()).id);
      const res = await request(server).get('/api/v1/members/me/points').set('Cookie', memberCookie).expect(200);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
    });

    it('exposes a public profile point summary and achievement list with no auth required', async () => {
      await pointsService.awardAttendance(member.id, (await seedEvent()).id);
      await request(server).get(`/api/v1/members/${member.id}/points`).expect(200);
      const res = await request(server).get(`/api/v1/members/${member.id}/achievements`).expect(200);
      expect(res.body.some((a: { key: string }) => a.key === 'first_dinner')).toBe(true);
    });
  });

  describe('GET /users/members sort + New badge', () => {
    it('defaults to newest-first when no sort is given', async () => {
      const older = await seedUser(dataSource, city.id, { fullName: 'AAA Older', email: 'older@example.test' });
      await dataSource.getRepository(UserEntity).update(older.id, { createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) });
      const newer = await seedUser(dataSource, city.id, { fullName: 'ZZZ Newer', email: 'newer@example.test' });

      const res = await request(server).get('/api/v1/users/members').set('Cookie', memberCookie).expect(200);
      const ids = res.body.map((m: { id: number }) => m.id);
      expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
    });

    it('sorts alphabetically when sort=alpha', async () => {
      await seedUser(dataSource, city.id, { fullName: 'Zeta Member', email: 'zeta@example.test' });
      await seedUser(dataSource, city.id, { fullName: 'Alpha Member', email: 'alpha@example.test' });

      const res = await request(server).get('/api/v1/users/members').query({ sort: 'alpha' }).set('Cookie', memberCookie).expect(200);
      const names = res.body.map((m: { fullName: string }) => m.fullName);
      expect(names).toEqual([...names].sort());
    });

    it('falls back to newest for an unrecognized sort value rather than rejecting the request', async () => {
      await request(server).get('/api/v1/users/members').query({ sort: 'points' }).set('Cookie', memberCookie).expect(200);
    });

    it('flags a recently created member with isNew', async () => {
      const res = await request(server).get('/api/v1/users/members').set('Cookie', memberCookie).expect(200);
      const self = res.body.find((m: { id: number }) => m.id === member.id);
      expect(self.isNew).toBe(true);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).get('/api/v1/users/members').expect(401);
    });
  });
});

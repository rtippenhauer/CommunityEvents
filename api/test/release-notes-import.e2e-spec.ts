import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import request from 'supertest';
import { createTestApp, truncateAllTables } from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { ReleaseNotesImporterService } from '../src/modules/releases/release-notes-importer.service';
import { WhatsNewService } from '../src/modules/community/whats-new.service';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { UserRole } from '../src/database/enums';

const FIXTURES_DIR = join(__dirname, 'fixtures', 'release-notes');
const EMPTY_DRAFT_DIR = join(__dirname, 'fixtures', 'release-notes-empty-draft');
const MISSING_DIR = join(__dirname, 'fixtures', 'release-notes-does-not-exist');
// Four notes whose alphabetical order is not their version order (1.6.10 sorts
// before 1.6.2), imported in one boot the way v1's backlog will be.
const MANY_DIR = join(__dirname, 'fixtures', 'release-notes-many');

// Phase 33 (release-note pipeline): shared release notes ship inside the
// Docker image (see docs/RELEASE_NOTE_PIPELINE_SPEC.md) and get imported into
// this instance's own `releases` table at boot. Covers: finalized notes
// import as published, idempotent re-import, the IS_STAGE gate on the draft,
// and the empty/missing-content cases.
describe('Release notes boot-time import (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let configService: ConfigService;
  let importer: ReleaseNotesImporterService;
  let city: { id: number };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    configService = app.get(ConfigService);
    importer = app.get(ReleaseNotesImporterService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    configService.set('RELEASE_NOTES_DIR', FIXTURES_DIR);
    configService.set('IS_STAGE', 'false');

    city = await seedCity(prisma);
    await seedUser(prisma, city.id, {
      role: UserRole.AUTOMATION,
      email: 'automation@test-root.internal',
      fullName: 'Claude Automation',
    });
  });

  it('imports a finalized note as a published release', async () => {
    await importer.importAll();

    const release = await prisma.releases.findFirst({ where: { version: '9.9.9' } });
    expect(release).not.toBeNull();
    expect(release!.title).toBe('Test Release Title');
    expect(release!.publishedAt).not.toBeNull();
    expect(release!.body).toContain('leaderboard');
    expect(release!.body).toContain('<li>First bullet</li>');
  });

  it('is idempotent on re-import — no duplicate row, publishedAt unchanged', async () => {
    await importer.importAll();
    const first = await prisma.releases.findFirst({ where: { version: '9.9.9' } });

    await importer.importAll();
    const all = await prisma.releases.findMany({ where: { version: '9.9.9' } });
    const second = all[0];

    expect(all).toHaveLength(1);
    expect(second.publishedAt?.getTime()).toBe(first!.publishedAt?.getTime());
  });

  it('does not import the draft when IS_STAGE is not true', async () => {
    configService.set('IS_STAGE', 'false');
    await importer.importAll();

    const draft = await prisma.releases.findFirst({ where: { version: 'Upcoming' } });
    expect(draft).toBeNull();
  });

  it('imports the draft with a placeholder version when IS_STAGE is true', async () => {
    configService.set('IS_STAGE', 'true');
    await importer.importAll();

    const draft = await prisma.releases.findFirst({ where: { version: 'Upcoming' } });
    expect(draft).not.toBeNull();
    expect(draft!.title).toBe("What's New (In Progress)");
    expect(draft!.publishedAt).not.toBeNull();
    expect(draft!.body).toContain('Some In-Progress Feature');
    // The boilerplate intro before the first ## heading must be stripped.
    expect(draft!.body).not.toContain('Running draft of unreleased');
  });

  it('removes a stale draft row once IS_STAGE flips back to false', async () => {
    configService.set('IS_STAGE', 'true');
    await importer.importAll();
    expect(await prisma.releases.findFirst({ where: { version: 'Upcoming' } })).not.toBeNull();

    configService.set('IS_STAGE', 'false');
    await importer.importAll();
    expect(await prisma.releases.findFirst({ where: { version: 'Upcoming' } })).toBeNull();
  });

  it('skips the draft when it has no content past the reset template', async () => {
    configService.set('RELEASE_NOTES_DIR', EMPTY_DRAFT_DIR);
    configService.set('IS_STAGE', 'true');
    await importer.importAll();

    const draft = await prisma.releases.findFirst({ where: { version: 'Upcoming' } });
    expect(draft).toBeNull();
  });

  it('does not crash when the release-notes directory is missing', async () => {
    configService.set('RELEASE_NOTES_DIR', MISSING_DIR);
    await expect(importer.importAll()).resolves.toBeUndefined();
  });

  // Regression (found live on stage.dinnerbears.com 2026-07-27): the account
  // lookup used to filter on role AUTOMATION too, so temporarily elevating
  // the account via the admin role-picker (a supported, documented flow —
  // see users.service.ts's isAutomationAccount comment) made the importer
  // silently skip every import until the role was flipped back. Matching by
  // name + email instead (role can be any level) fixes this.
  it('still finds the automation account by name+email when its role has been temporarily elevated', async () => {
    await prisma.users.updateMany({
      where: { email: 'automation@test-root.internal' },
      data: { role: UserRole.ADMIN },
    });

    await importer.importAll();

    const release = await prisma.releases.findFirst({ where: { version: '9.9.9' } });
    expect(release).not.toBeNull();
    expect(release!.publishedAt).not.toBeNull();
  });

  // v2-33 ride-alongs. published_at is DATETIME(0) and every note in one boot
  // is written with NOW(), so several notes share a second; the splash must
  // still pick the newest version, and the importer must insert in version
  // order (not readdir's) for the id tiebreaker to mean anything.
  describe('several notes imported in one pass', () => {
    beforeEach(() => {
      configService.set('RELEASE_NOTES_DIR', MANY_DIR);
    });

    it('inserts them in version order, 1.6.10 after 1.6.9', async () => {
      await importer.importAll();
      const rows = await prisma.releases.findMany({ orderBy: { id: 'asc' }, select: { version: true } });
      expect(rows.map((r) => r.version)).toEqual(['1.6.1', '1.6.2', '1.6.9', '1.6.10']);
    });

    it('shows the newest version on the splash when they tie on published_at', async () => {
      await importer.importAll();
      // Force the tie rather than hoping the loop stayed inside one second.
      await prisma.releases.updateMany({ data: { publishedAt: new Date('2026-10-15T12:00:00Z') } });
      const member = await seedUser(prisma, city.id, { email: 'member@example.test' });

      const { release } = await app.get(WhatsNewService).getUnseen(member.id);
      expect(release?.version).toBe('1.6.10');
    });

    // The defect this rides on: unpublishing a release re-announced an older
    // one to every member. Run against a real database because the watermark
    // and its backfill are columns, and because the ordering that makes the
    // bug possible (publish date, not id) is the database's.
    it('does not re-announce an older release after the newest is unpublished', async () => {
      await importer.importAll();
      const rows = await prisma.releases.findMany({ orderBy: { id: 'asc' } });
      const oldest = rows[0]; // 1.6.1 -- the LOWEST id

      // Publish dates that disagree with the ids, which is the stage case: a
      // note drafted first and published last. Every other note keeps the
      // importer's NOW(), so they are moved back together first.
      await prisma.releases.updateMany({ data: { publishedAt: new Date('2026-10-15T12:00:00Z') } });
      await prisma.releases.update({
        where: { id: oldest.id },
        data: { publishedAt: new Date('2026-10-19T12:00:00Z') },
      });

      const member = await seedUser(prisma, city.id, { email: 'member@example.test' });
      const whatsNew = app.get(WhatsNewService);

      const first = await whatsNew.getUnseen(member.id);
      expect(first.release?.id).toBe(oldest.id);
      await whatsNew.markReleaseSeen(member.id, oldest.id);
      expect((await whatsNew.getUnseen(member.id)).release).toBeNull();

      // Unpublished the way `ReleasesService.unpublish` does it -- straight to
      // NULL. That service is not used here because publishing also walks
      // tenant-scoped feedback, which is not what this is about.
      await prisma.releases.update({ where: { id: oldest.id }, data: { publishedAt: null } });

      // An older release is latest again, with a HIGHER id than the watermark:
      // the exact shape `id !== lastSeenReleaseId` got wrong.
      const after = await whatsNew.getUnseen(member.id);
      expect(after.release).toBeNull();
    });

    it('lists them newest first on the Updates page', async () => {
      await importer.importAll();
      await prisma.releases.updateMany({ data: { publishedAt: new Date('2026-10-15T12:00:00Z') } });

      const member = await seedUser(prisma, city.id, { email: 'member@example.test' });
      const res = await request(app.getHttpServer())
        .get('/api/v1/releases')
        .set('Cookie', await loginAs(app, member))
        .expect(200);
      expect(res.body.map((r: { version: string }) => r.version)).toEqual(['1.6.10', '1.6.9', '1.6.2', '1.6.1']);
    });
  });
});

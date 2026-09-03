import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { createTestApp, truncateAllTables } from './utils/test-app';
import { seedCity, seedUser } from './utils/seed';
import { ReleaseNotesImporterService } from '../src/modules/releases/release-notes-importer.service';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { UserRole } from '../src/database/enums';

const FIXTURES_DIR = join(__dirname, 'fixtures', 'release-notes');
const EMPTY_DRAFT_DIR = join(__dirname, 'fixtures', 'release-notes-empty-draft');
const MISSING_DIR = join(__dirname, 'fixtures', 'release-notes-does-not-exist');

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

    const city = await seedCity(prisma);
    await seedUser(prisma, city.id, {
      role: UserRole.AUTOMATION,
      email: 'automation@communityevents.internal',
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
      where: { email: 'automation@communityevents.internal' },
      data: { role: UserRole.ADMIN },
    });

    await importer.importAll();

    const release = await prisma.releases.findFirst({ where: { version: '9.9.9' } });
    expect(release).not.toBeNull();
    expect(release!.publishedAt).not.toBeNull();
  });
});

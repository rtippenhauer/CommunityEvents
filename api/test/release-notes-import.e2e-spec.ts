import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { join } from 'path';
import { createTestApp, truncateAllTables } from './utils/test-app';
import { seedCity, seedUser } from './utils/seed';
import { UserRole } from '../src/database/entities/user.entity';
import { ReleaseEntity } from '../src/database/entities/release.entity';
import { ReleaseNotesImporterService } from '../src/modules/releases/release-notes-importer.service';

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
  let dataSource: DataSource;
  let configService: ConfigService;
  let importer: ReleaseNotesImporterService;

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
    configService = app.get(ConfigService);
    importer = app.get(ReleaseNotesImporterService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    configService.set('RELEASE_NOTES_DIR', FIXTURES_DIR);
    configService.set('IS_STAGE', 'false');

    const city = await seedCity(dataSource);
    await seedUser(dataSource, city.id, {
      role: UserRole.AUTOMATION,
      email: 'automation@dinnerbears.internal',
    });
  });

  function releaseRepo() {
    return dataSource.getRepository(ReleaseEntity);
  }

  it('imports a finalized note as a published release', async () => {
    await importer.importAll();

    const release = await releaseRepo().findOne({ where: { version: '9.9.9' } });
    expect(release).not.toBeNull();
    expect(release!.title).toBe('Test Release Title');
    expect(release!.publishedAt).not.toBeNull();
    expect(release!.body).toContain('leaderboard');
    expect(release!.body).toContain('<li>First bullet</li>');
  });

  it('is idempotent on re-import — no duplicate row, publishedAt unchanged', async () => {
    await importer.importAll();
    const first = await releaseRepo().findOne({ where: { version: '9.9.9' } });

    await importer.importAll();
    const all = await releaseRepo().find({ where: { version: '9.9.9' } });
    const second = all[0];

    expect(all).toHaveLength(1);
    expect(second.publishedAt?.getTime()).toBe(first!.publishedAt?.getTime());
  });

  it('does not import the draft when IS_STAGE is not true', async () => {
    configService.set('IS_STAGE', 'false');
    await importer.importAll();

    const draft = await releaseRepo().findOne({ where: { version: 'Upcoming' } });
    expect(draft).toBeNull();
  });

  it('imports the draft with a placeholder version when IS_STAGE is true', async () => {
    configService.set('IS_STAGE', 'true');
    await importer.importAll();

    const draft = await releaseRepo().findOne({ where: { version: 'Upcoming' } });
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
    expect(await releaseRepo().findOne({ where: { version: 'Upcoming' } })).not.toBeNull();

    configService.set('IS_STAGE', 'false');
    await importer.importAll();
    expect(await releaseRepo().findOne({ where: { version: 'Upcoming' } })).toBeNull();
  });

  it('skips the draft when it has no content past the reset template', async () => {
    configService.set('RELEASE_NOTES_DIR', EMPTY_DRAFT_DIR);
    configService.set('IS_STAGE', 'true');
    await importer.importAll();

    const draft = await releaseRepo().findOne({ where: { version: 'Upcoming' } });
    expect(draft).toBeNull();
  });

  it('does not crash when the release-notes directory is missing', async () => {
    configService.set('RELEASE_NOTES_DIR', MISSING_DIR);
    await expect(importer.importAll()).resolves.toBeUndefined();
  });
});

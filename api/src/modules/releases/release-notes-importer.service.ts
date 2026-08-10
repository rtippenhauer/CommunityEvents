import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { join } from 'path';
import { marked } from 'marked';
// Default import, not `import * as`: sanitize-html is a CommonJS module whose
// export IS the function. A namespace object is not callable under ESM, so
// `import * as` only worked because tsc emitted CommonJS — it throws
// "is not a function" the moment the file is loaded as a real ES module,
// which is how Vitest loads it.
import sanitizeHtml from 'sanitize-html';
import { PrismaService } from '../../database/prisma/prisma.service';
import { ALLOWED_HTML } from './releases.service';

const DRAFT_FILE = '_draft.md';
const DRAFT_VERSION = 'Upcoming';
const DRAFT_TITLE = "What's New (In Progress)";
const AUTOMATION_EMAIL = 'automation@dinnerbears.internal';
const AUTOMATION_NAME = 'Claude Automation';

// Shared release notes (see docs/RELEASE_NOTE_PIPELINE_SPEC.md) ship inside the
// Docker image — one markdown file per finalized version under release-notes/,
// plus release-notes/_draft.md which is docs/NEXT_RELEASE.md copied in at build
// time (see Dockerfile). This runs on every boot and upserts them into this
// instance's own `releases` table, keyed by version, so:
//   - a note only ever appears once THIS instance is actually running the code
//     it describes — no cross-instance calls, no version-skew leaks
//   - the in-progress draft only ever surfaces on stage (IS_STAGE=true), never
//     prod, and disappears again once /release finalizes it (the shipped
//     _draft.md goes back to the empty template)
// Cutting a release IS the publish approval for shared notes (a scoped, Rob-
// approved exception to "Claude never publishes" — see CLAUDE.md /release and
// feedback_branching_workflow memory) — finalized entries always import as
// published. Instance-specific notes authored by hand in /admin/releases/new
// are completely untouched by this — still manual create + manual publish.
@Injectable()
export class ReleaseNotesImporterService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReleaseNotesImporterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.importAll();
  }

  async importAll(): Promise<void> {
    const dir = this.config.get<string>('RELEASE_NOTES_DIR', join(process.cwd(), 'release-notes'));

    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      this.logger.log(`No release-notes directory at ${dir} — skipping import`);
      return;
    }

    const authorId = await this.getAutomationAuthorId();
    if (authorId === null) {
      this.logger.warn('Automation account not found — skipping release notes import');
      return;
    }

    const finalized = files.filter((f) => f.endsWith('.md') && f !== DRAFT_FILE);
    for (const file of finalized) {
      await this.importFinalized(dir, file, authorId);
    }

    const isStage = this.config.get<string>('IS_STAGE') === 'true';
    if (files.includes(DRAFT_FILE)) {
      await this.importDraft(dir, isStage, authorId);
    }
  }

  private async getAutomationAuthorId(): Promise<number | null> {
    // Matched by name + email, not role — the account's role is mutable
    // (Rob's admin role-picker can temporarily elevate it to member/
    // moderator/admin for testing, same pattern users.service.ts's
    // isAutomationAccount flag relies on), so filtering on role too would
    // make this silently stop finding the account whenever it's elevated at
    // boot time, even though the account otherwise still exists. Name is
    // included alongside the (already-unique) email as a belt-and-suspenders
    // check that this is specifically the seeded Claude Automation account.
    const user = await this.prisma.users.findFirst({
      where: { email: AUTOMATION_EMAIL, fullName: AUTOMATION_NAME },
    });
    return user?.id ?? null;
  }

  private parseNote(raw: string): { title: string; body: string } {
    const lines = raw.replace(/^﻿/, '').split('\n');
    let title = '';
    let bodyStart = 0;
    if (lines[0]?.startsWith('# ')) {
      title = lines[0].slice(2).trim();
      bodyStart = 1;
    }
    const bodyMarkdown = lines.slice(bodyStart).join('\n').trim();
    const body = sanitizeHtml(marked.parse(bodyMarkdown, { async: false }) as string, ALLOWED_HTML);
    return { title, body };
  }

  private async importFinalized(dir: string, file: string, authorId: number): Promise<void> {
    const version = file.slice(0, -'.md'.length);
    const raw = await fs.readFile(join(dir, file), 'utf-8');
    const { title, body } = this.parseNote(raw);
    if (!title || !body) {
      this.logger.warn(`Skipping ${file}: missing title or body`);
      return;
    }

    // Left as raw SQL: ON DUPLICATE KEY UPDATE deliberately refreshes only
    // title and body, leaving published_at at its original value. An upsert
    // would have to name every column and would rewrite the publish date.
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO releases (version, title, body, published_at, created_by)
       VALUES (?, ?, ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE title = VALUES(title), body = VALUES(body)`,
      version,
      title,
      body,
      authorId,
    );
  }

  private async importDraft(dir: string, isStage: boolean, authorId: number): Promise<void> {
    if (!isStage) {
      await this.prisma.releases.deleteMany({ where: { version: DRAFT_VERSION } });
      return;
    }

    const raw = await fs.readFile(join(dir, DRAFT_FILE), 'utf-8');
    const headingMatch = raw.match(/^##\s.*$/m);
    if (!headingMatch) {
      // The reset/empty template — no real draft content yet.
      await this.prisma.releases.deleteMany({ where: { version: DRAFT_VERSION } });
      return;
    }

    const bodyMarkdown = raw.slice(raw.indexOf(headingMatch[0]));
    const body = sanitizeHtml(marked.parse(bodyMarkdown, { async: false }) as string, ALLOWED_HTML);

    await this.prisma.$executeRawUnsafe(
      `INSERT INTO releases (version, title, body, published_at, created_by)
       VALUES (?, ?, ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE title = VALUES(title), body = VALUES(body)`,
      DRAFT_VERSION,
      DRAFT_TITLE,
      body,
      authorId,
    );
  }
}

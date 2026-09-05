import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { TenantResolutionService } from '../src/common/tenant/tenant-resolution.service';
import { EmailService } from '../src/modules/email/email.service';
import { AppConfigService } from '../src/modules/app-config/app-config.service';
import { runUnscoped, runWithTenant } from '../src/common/tenant/tenant-store';
import { createTestApp, truncateAllTables } from './utils/test-app';
import { TEST_TENANT_ID } from './setup-env';

const inTenant = <T>(tenantId: number, fn: () => Promise<T>): Promise<T> =>
  runWithTenant(tenantId, async () => await fn());

/**
 * Every outgoing email carries the community's own name.
 *
 * Found on the v2-7 stage pass: a real invite and a real verification email
 * arrived saying "Welcome to DinnerBears!" from a sender correctly named
 * "Community Events Project". The sender name was already configurable; the
 * body copy was string literals in `auth.service.ts`.
 *
 * The fix substitutes `{{brand}}` once, in EmailService, rather than at each
 * call site — so these tests are really about the substitution point, not about
 * any one message. The interesting case is the last one: branding resolved
 * under `runUnscoped` must NOT return an arbitrary tenant's name.
 */
describe('Email branding (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let email: EmailService;
  let appConfig: AppConfigService;

  const TENANT_B_ID = 2;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    email = app.get(EmailService);
    appConfig = app.get(AppConfigService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    app.get(TenantResolutionService).clearCache();

    await prisma.tenants.create({
      data: { id: TENANT_B_ID, slug: 'second', domain: 'second-community.test' },
    });
  });

  /** The row a community writes when an admin sets App Name in Site Settings. */
  const setBrand = (tenantId: number, name: string) =>
    inTenant(tenantId, () =>
      prisma.app_config.create({ data: { configKey: 'brand_name', configValue: name } }),
    );

  const queued = () =>
    runUnscoped('read the queue across tenants', async () =>
      prisma.email_queue.findMany({ orderBy: { id: 'asc' } }),
    );

  it('substitutes the community name into the subject and body', async () => {
    await setBrand(TEST_TENANT_ID, 'Dayton Dinners');

    await inTenant(TEST_TENANT_ID, () =>
      email.queue({
        toEmail: 'member@example.test',
        subject: 'Verify your {{brand}} email',
        htmlBody: '<h2>Welcome to {{brand}}!</h2><p>Ignore if you did not join {{brand}}.</p>',
        textBody: 'Welcome to {{brand}}!',
        bypassSuppression: true,
      }),
    );

    const [row] = await queued();
    expect(row.subject).toBe('Verify your Dayton Dinners email');
    // Containment, not equality: v2-10 wraps a bare body in the community's
    // shell, so asserting the exact fragment would pin an implementation
    // detail rather than the substitution this test is about.
    expect(row.htmlBody).toContain(
      '<h2>Welcome to Dayton Dinners!</h2><p>Ignore if you did not join Dayton Dinners.</p>',
    );
    expect(row.textBody).toBe('Welcome to Dayton Dinners!');
    // Every occurrence, not just the first.
    expect(row.htmlBody).not.toContain('{{brand}}');
  });

  it("wraps a bare html body in the community's own shell", async () => {
    await setBrand(TEST_TENANT_ID, 'Dayton Dinners');

    await inTenant(TEST_TENANT_ID, () =>
      email.queue({
        toEmail: 'member@example.test',
        subject: 'Bare body',
        htmlBody: '<h2>Hello</h2>',
        bypassSuppression: true,
      }),
    );

    const [row] = await queued();
    // The header the invite, reset and verification emails never had: a logo,
    // and the community's name in the footer.
    expect(row.htmlBody).toMatch(/^<!DOCTYPE html>/);
    expect(row.htmlBody).toContain('<img src=');
    expect(row.htmlBody).toContain('alt="Dayton Dinners"');
    expect(row.htmlBody).toContain('<h2>Hello</h2>');
  });

  it('leaves a body that is already a full document alone', async () => {
    await setBrand(TEST_TENANT_ID, 'Dayton Dinners');
    // The event templates build their own document with their own logo band.
    // Wrapping one would nest <html> inside <body> and show two logos.
    const full =
      '<!DOCTYPE html><html lang="en"><body><p>Already built</p></body></html>';

    await inTenant(TEST_TENANT_ID, () =>
      email.queue({
        toEmail: 'member@example.test',
        subject: 'Full document',
        htmlBody: full,
        bypassSuppression: true,
      }),
    );

    const [row] = await queued();
    expect(row.htmlBody).toBe(full);
  });

  it('gives each community its own name for the same message', async () => {
    await setBrand(TEST_TENANT_ID, 'Dayton Dinners');
    await setBrand(TENANT_B_ID, 'Cincinnati Suppers');

    const send = (tenantId: number) =>
      inTenant(tenantId, () =>
        email.queue({
          toEmail: 'member@example.test',
          subject: 'Welcome to {{brand}}',
          bypassSuppression: true,
        }),
      );

    await send(TEST_TENANT_ID);
    await send(TENANT_B_ID);

    const subjects = (await queued()).map((row) => row.subject);
    expect(subjects).toEqual(['Welcome to Dayton Dinners', 'Welcome to Cincinnati Suppers']);
  });

  it('falls back to the deployment default when a community has set no name', async () => {
    await inTenant(TEST_TENANT_ID, () =>
      email.queue({
        toEmail: 'member@example.test',
        subject: 'Reset your {{brand}} password',
        bypassSuppression: true,
      }),
    );

    const [row] = await queued();
    expect(row.subject).toBe('Reset your CommunityEvents password');
    // The inherited default is gone; this is the v2-10 fallback landing early.
    expect(row.subject).not.toContain('DinnerBears');
  });

  // The trap. `app_config` is tenant-scoped, so a brand read with no tenant in
  // context would answer with whichever row came back first -- one community's
  // name on another community's mail. The deployment default is the only
  // honest answer here.
  it('does not borrow another community name when there is no tenant context', async () => {
    await setBrand(TEST_TENANT_ID, 'Dayton Dinners');
    await setBrand(TENANT_B_ID, 'Cincinnati Suppers');

    const name = await runUnscoped('a cron sweep that forgot to re-enter a tenant', async () =>
      appConfig.brandName(),
    );

    expect(name).toBe('CommunityEvents');
    expect(name).not.toBe('Dayton Dinners');
    expect(name).not.toBe('Cincinnati Suppers');
  });

  it('passes the brand to Brevo templates as a parameter', async () => {
    await setBrand(TEST_TENANT_ID, 'Dayton Dinners');

    await inTenant(TEST_TENANT_ID, () =>
      email.queue({
        toEmail: 'member@example.test',
        subject: 'Anything',
        templateParams: { firstName: 'Rob' },
        bypassSuppression: true,
      }),
    );

    const [row] = await queued();
    // A Brevo-side template renders its own copy; the most this code can do is
    // make the name available to one written to use it.
    expect(row.templateParams).toMatchObject({ brand: 'Dayton Dinners', firstName: 'Rob' });
  });
});

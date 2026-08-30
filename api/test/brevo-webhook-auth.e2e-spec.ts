import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { runWithTenant } from '../src/common/tenant/tenant-store';
import { BrevoWebhookService } from '../src/modules/email/brevo-webhook.service';
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedUser } from './utils/seed';
import { TEST_TENANT_ID } from './setup-env';
import { UserRole, EmailStatus } from '../src/database/enums';

const inTenant = <T>(tenantId: number, fn: () => Promise<T>): Promise<T> =>
  runWithTenant(tenantId, async () => await fn());

/**
 * Who is allowed to tell this deployment that an address bounced.
 *
 * The answer used to be "anyone holding one deployment-wide secret, passed in
 * the query string" — which put a shared credential in every access log between
 * Brevo and here, and meant one community's webhook could report on another's.
 * As of v2-9 the token is per-community, travels in an Authorization header, and
 * is stored encrypted: so it cannot be looked up by value, and the tenant has to
 * come from the Host header first.
 *
 * Forging one of these is not harmless — it suppresses an arbitrary address
 * across every community, which is a quiet way to cut somebody off from mail.
 */
describe('Brevo webhook authentication (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];

  const CURRENT = 'current-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const PREVIOUS = 'previous-token-bbbbbbbbbbbbbbbbbbbbbbbbbb';

  const bounceFor = (email: string) => [{ event: 'hard_bounce', email }];

  const configure = (data: Record<string, unknown>) =>
    inTenant(TEST_TENANT_ID, () =>
      prisma.email_provider_config.create({
        data: {
          brevoEnabled: true,
          resendOverflowEnabled: false,
          brevoDailyLimit: 300,
          resendDailyLimit: 1000,
          brevoSentToday: 0,
          resendSentToday: 0,
          lastResetDate: new Date(),
          ...data,
        },
      }),
    );

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
    const city = await seedCity(prisma);
    await seedUser(prisma, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
  });

  it('accepts this community token and acts on the event', async () => {
    await configure({ webhookSecret: CURRENT, webhookRotatedAt: new Date() });

    await request(server)
      .post('/api/v1/email/webhook/brevo')
      .set('Authorization', `Bearer ${CURRENT}`)
      .send(bounceFor('member@example.test'))
      .expect(201);

    const member = await inTenant(TEST_TENANT_ID, () =>
      prisma.users.findFirst({ where: { email: 'member@example.test' } }),
    );
    expect(member!.emailStatus).toBe(EmailStatus.BOUNCED);
  });

  it('rejects a wrong token, and changes nothing', async () => {
    await configure({ webhookSecret: CURRENT, webhookRotatedAt: new Date() });

    await request(server)
      .post('/api/v1/email/webhook/brevo')
      .set('Authorization', 'Bearer not-the-token-aaaaaaaaaaaaaaaaaaaaaa')
      .send(bounceFor('member@example.test'))
      .expect(401);

    const member = await inTenant(TEST_TENANT_ID, () =>
      prisma.users.findFirst({ where: { email: 'member@example.test' } }),
    );
    expect(member!.emailStatus).not.toBe(EmailStatus.BOUNCED);
  });

  it('rejects a caller presenting no token at all', async () => {
    await configure({ webhookSecret: CURRENT, webhookRotatedAt: new Date() });

    await request(server)
      .post('/api/v1/email/webhook/brevo')
      .send(bounceFor('member@example.test'))
      .expect(401);
  });

  it('still accepts the replaced token inside the grace window', async () => {
    // A callback already in flight when a rotation lands must not be rejected:
    // a bounce that never arrives is an address the deployment keeps mailing.
    await configure({
      webhookSecret: CURRENT,
      webhookSecretPrevious: PREVIOUS,
      webhookRotatedAt: new Date(),
    });

    await request(server)
      .post('/api/v1/email/webhook/brevo')
      .set('Authorization', `Bearer ${PREVIOUS}`)
      .send(bounceFor('member@example.test'))
      .expect(201);
  });

  it('stops accepting the replaced token once the window has passed', async () => {
    await configure({
      webhookSecret: CURRENT,
      webhookSecretPrevious: PREVIOUS,
      webhookRotatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });

    await request(server)
      .post('/api/v1/email/webhook/brevo')
      .set('Authorization', `Bearer ${PREVIOUS}`)
      .send(bounceFor('member@example.test'))
      .expect(401);
  });

  // These two run on the scheduler, which means no request and therefore no
  // tenant in context -- and that is the whole point of calling them bare here.
  // Both threw in production on the first hour boundary after deploying:
  // `runUnscoped(reason, () => prisma.x.updateMany())` returns a Prisma promise
  // unawaited, so the query was built inside the context and executed outside
  // it. Nothing in the suite ran a cron, so nothing caught it.
  describe('scheduled sweeps, called the way the scheduler calls them', () => {
    it('clears a replaced token past its window without a tenant in context', async () => {
      await configure({
        webhookSecret: CURRENT,
        webhookSecretPrevious: PREVIOUS,
        webhookRotatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      });

      await app.get(BrevoWebhookService).clearExpiredPreviousTokens();

      const after = await inTenant(TEST_TENANT_ID, () =>
        prisma.email_provider_config.findFirst(),
      );
      expect(after!.webhookSecretPrevious).toBeNull();
      expect(after!.webhookSecret).toBe(CURRENT);
    });

    it('looks for rotation candidates without a tenant in context', async () => {
      // No webhook is registered, so nothing is due and Brevo is never called --
      // but the query that failed in production still runs, which is the point.
      await configure({ webhookSecret: CURRENT, webhookRotatedAt: new Date() });

      await expect(app.get(BrevoWebhookService).rotateDueTokens()).resolves.toBeUndefined();
    });
  });

  /**
   * What Brevo is already holding when we try to register.
   *
   * Found on stage the moment the Re-register button was pressed on a community
   * that already had a webhook: `register()` treated "mint a new token" as
   * "create a new webhook", so it always POSTed, and Brevo answers a POST for a
   * URL it already holds with `duplicate_parameter`. The button could therefore
   * never succeed in any situation anyone would press it in -- including every
   * community registered before this code existed.
   */
  describe('registering over what Brevo already has', () => {
    const svc = () => app.get(BrevoWebhookService);

    const mockBrevo = (
      handler: (method: string, url: string, body: unknown) => Response,
    ): void => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (input: RequestInfo | URL, init?: RequestInit) =>
          handler(
            init?.method ?? 'GET',
            String(input),
            init?.body ? JSON.parse(String(init.body)) : undefined,
          ),
      );
    };

    const duplicate = () =>
      new Response(
        JSON.stringify({ code: 'duplicate_parameter', message: 'Notify url already exists' }),
        { status: 400 },
      );

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('adopts a webhook that already exists at this URL', async () => {
      await configure({ brevoApiKey: 'key-for-this-account', webhookSecret: CURRENT });

      let registeredUrl: string | undefined;
      const seen: string[] = [];
      mockBrevo((method, url, body) => {
        seen.push(`${method} ${url}`);
        if (method === 'POST') {
          registeredUrl = (body as { url: string }).url;
          return duplicate();
        }
        if (method === 'GET') {
          return new Response(JSON.stringify({ webhooks: [{ id: 42, url: registeredUrl }] }), {
            status: 200,
          });
        }
        return new Response(null, { status: 204 });
      });

      const result = await inTenant(TEST_TENANT_ID, () => svc().register({ newToken: true }));

      expect(result.ok).toBe(true);
      // Looked it up and updated it, rather than giving up on the POST.
      expect(seen.some((call) => call.startsWith('GET'))).toBe(true);
      expect(seen.some((call) => call.includes('PUT') && call.endsWith('/42'))).toBe(true);

      const after = await inTenant(TEST_TENANT_ID, () =>
        prisma.email_provider_config.findFirst(),
      );
      expect(after!.webhookId).toBe('42');
      expect(after!.webhookError).toBeNull();
    });

    it('creates a new one when the id we hold belongs to another account', async () => {
      // A replaced API key can point at an entirely different Brevo account,
      // where the webhook we recorded does not exist. That is a 404, and the
      // recovery is to create rather than to fail.
      await configure({
        brevoApiKey: 'key-for-a-different-account',
        webhookSecret: CURRENT,
        webhookId: '999',
      });

      const seen: string[] = [];
      mockBrevo((method, url) => {
        seen.push(`${method} ${url}`);
        if (method === 'PUT') return new Response('no such webhook', { status: 404 });
        if (method === 'POST') return new Response(JSON.stringify({ id: 7 }), { status: 201 });
        return new Response(null, { status: 204 });
      });

      const result = await inTenant(TEST_TENANT_ID, () => svc().register({ newToken: true }));

      expect(result.ok).toBe(true);
      expect(seen.some((call) => call.startsWith('PUT'))).toBe(true);
      expect(seen.some((call) => call.startsWith('POST'))).toBe(true);
      const after = await inTenant(TEST_TENANT_ID, () =>
        prisma.email_provider_config.findFirst(),
      );
      expect(after!.webhookId).toBe('7');
    });

    it('surfaces a failure it cannot route around, and records why', async () => {
      // A revoked key is not something to recover from by creating a second
      // webhook. It needs the operator, so it has to reach the screen.
      await configure({ brevoApiKey: 'revoked', webhookSecret: CURRENT });
      mockBrevo(() => new Response('{"message":"Key not found"}', { status: 401 }));

      const result = await inTenant(TEST_TENANT_ID, () => svc().register({ newToken: true }));

      expect(result.ok).toBe(false);
      const after = await inTenant(TEST_TENANT_ID, () =>
        prisma.email_provider_config.findFirst(),
      );
      expect(after!.webhookError).toContain('401');
    });
  });

  it('keeps honouring the deployment-wide secret in the query string', async () => {
    // A webhook registered before v2-9 keeps delivering until its community
    // re-registers. Dropping the old form on upgrade would lose events in
    // exactly the window where nobody is watching for them.
    await configure({ webhookSecret: CURRENT, webhookRotatedAt: new Date() });

    await request(server)
      .post(`/api/v1/email/webhook/brevo?secret=${process.env.BREVO_WEBHOOK_SECRET}`)
      .send(bounceFor('member@example.test'))
      .expect(201);
  });
});

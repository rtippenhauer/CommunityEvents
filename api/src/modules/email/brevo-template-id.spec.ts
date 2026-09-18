import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { BrevoService } from './brevo.service';
import { PrismaService } from '../../database/prisma/prisma.service';
import { TenantResolutionService } from '../../common/tenant/tenant-resolution.service';
import { runWithTenant } from '../../common/tenant/tenant-store';

/**
 * Which Brevo template a send addresses, and whose account it belongs to.
 *
 * The id is a number in **one** Brevo account's own library. A community
 * sending on its own key that inherits the deployment's ids addresses whatever
 * happens to hold that number over there, or nothing -- and Brevo refuses the
 * send. Nothing about it looks wrong until it fails, which is why it is worth a
 * test rather than a comment.
 *
 * Asserted through `send` against a stubbed `fetch`, because what matters is
 * the body that actually leaves.
 */
describe('BrevoService — whose template library an id comes from', () => {
  const ENV_TEMPLATE_ID = 77;

  let sentBody: Record<string, unknown>;

  /** `row` is this community's email_provider_config, or null for none. */
  const make = (row: Record<string, unknown> | null) => {
    const prisma = {
      email_provider_config: { findFirst: async () => row },
    } as unknown as PrismaService;

    const config = {
      get: (key: string, fallback?: string) =>
        key === 'BREVO_TEMPLATE_INVITE'
          ? String(ENV_TEMPLATE_ID)
          : key === 'BREVO_API_KEY'
            ? 'deployment-key'
            : key === 'BREVO_FROM_EMAIL'
              ? 'noreply@deployment.test'
              : (fallback ?? ''),
    } as unknown as ConfigService;

    // Every community here is on the deployment's domain, so the v2-12 gate is
    // open and any inheriting that happens is the behaviour under test rather
    // than a side effect of it being withheld.
    const resolution = {
      isOnDeploymentDomain: async () => true,
      baseUrlFor: async () => 'https://deployment.test',
    } as unknown as TenantResolutionService;

    return new BrevoService(config, prisma, resolution);
  };

  /**
   * The context has to be established inside the test body, not a hook: Vitest
   * runs hooks in a sibling async context, so an ALS store set in `beforeEach`
   * never reaches the `it()`. Awaited inside the callback for the usual reason
   * -- handing a promise back would run the work outside the context.
   */
  const sendInvite = (service: BrevoService) =>
    runWithTenant(1, async () => {
      await service.send({
        toEmail: 'member@example.test',
        subject: 'You are invited',
        templateName: 'invite',
        htmlBody: '<p>fallback</p>',
      });
    });

  beforeEach(() => {
    sentBody = {};
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        sentBody = JSON.parse(init.body) as Record<string, unknown>;
        return { ok: true, json: async () => ({ messageId: 'x' }), text: async () => '' };
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses the deployment’s template id for a community sending on its key', async () => {
    // No key of its own, so it is sending on the deployment's account -- where
    // the deployment's ids are exactly the right ones.
    await sendInvite(make({ brevoApiKey: null, brevoFromEmail: null, tmplInvite: null }));
    expect(sentBody['templateId']).toBe(ENV_TEMPLATE_ID);
  });

  it('never sends the deployment’s id on a community’s own account', async () => {
    // The bug: that number names a template in the *deployment's* library, and
    // this send goes to a different account entirely.
    await sendInvite(
      make({ brevoApiKey: 'community-key', brevoFromEmail: 'hi@community.test', tmplInvite: null }),
    );
    expect(sentBody['templateId']).toBeUndefined();
  });

  it('falls through to the raw HTML instead, so the message still goes out', async () => {
    // Plain rather than templated is a cosmetic loss; a refused send is not.
    await sendInvite(
      make({ brevoApiKey: 'community-key', brevoFromEmail: 'hi@community.test', tmplInvite: null }),
    );
    expect(sentBody['htmlContent']).toBe('<p>fallback</p>');
  });

  it('uses a community’s own id when it has set one', async () => {
    await sendInvite(
      make({ brevoApiKey: 'community-key', brevoFromEmail: 'hi@community.test', tmplInvite: 12 }),
    );
    expect(sentBody['templateId']).toBe(12);
  });
});

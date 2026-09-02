import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { AppConfigService } from './app-config.service';
import { PrismaService } from '../../database/prisma/prisma.service';
import { TenantResolutionService } from '../../common/tenant/tenant-resolution.service';
import { TenantOAuthService } from '../../common/tenant/tenant-oauth.service';
import { runWithTenant } from '../../common/tenant/tenant-store';

/**
 * The precedence in AppConfigService's contact-identity block (REQ-TENANT-01.4).
 *
 * Worth testing at this level rather than only end to end, because the whole
 * risk in this change is an ordering mistake nobody sees: get it wrong and a
 * deployment that has set SUPPORT_EMAIL keeps working, so the bug only shows up
 * on the one community that opted in -- which is also the one nobody is
 * watching yet.
 */

function stubConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string, defaultValue?: string) => values[key] ?? defaultValue,
  } as unknown as ConfigService;
}

/** Stands in for the app_config table: whatever rows this tenant has set. */
function stubPrisma(rows: Record<string, string>): PrismaService {
  return {
    app_config: {
      findFirst: ({ where }: { where: { configKey: string } }) =>
        Promise.resolve(
          where.configKey in rows ? { configValue: rows[where.configKey] } : null,
        ),
    },
  } as unknown as PrismaService;
}

function make(
  rows: Record<string, string>,
  env: Record<string, string | undefined> = {},
): AppConfigService {
  return new AppConfigService(
    stubPrisma(rows),
    stubConfig({ APP_URL: 'https://communityeventsproject.com', ...env }),
    {} as unknown as TenantResolutionService,
    // Not exercised here: these specs cover contact-address precedence, and the
    // OAuth reader is only reached by getBrandingConfig.
    {} as unknown as TenantOAuthService,
  );
}

const TENANT = 7;

describe('contact identity precedence', () => {
  describe('with nothing set on the community', () => {
    // The property that makes this change safe to ship: an install that has not
    // touched the new keys sees byte-identical behaviour.
    it('falls back to the env var', async () => {
      const svc = make({}, { SUPPORT_EMAIL: 'help@deployment.test' });
      await expect(svc.supportEmail(TENANT)).resolves.toBe('help@deployment.test');
    });

    it('falls back to a derivation from the deployment mail domain', async () => {
      const svc = make({}, { BASE_DOMAIN: 'deployment.test' });
      await expect(svc.supportEmail(TENANT)).resolves.toBe('hello@deployment.test');
      await expect(svc.eventOrganizerEmail(TENANT)).resolves.toBe('noreply@deployment.test');
      await expect(svc.calendarOrganizerEmail(TENANT)).resolves.toBe('calendar@deployment.test');
    });
  });

  describe('with an explicit address on the community', () => {
    it('beats the env var', async () => {
      const svc = make(
        { contact_support_email: 'help@dayton.test' },
        { SUPPORT_EMAIL: 'help@deployment.test' },
      );
      await expect(svc.supportEmail(TENANT)).resolves.toBe('help@dayton.test');
    });

    it('applies per address, not all or nothing', async () => {
      const svc = make(
        { contact_event_email: 'events@dayton.test' },
        { SUPPORT_EMAIL: 'help@deployment.test' },
      );
      await expect(svc.eventOrganizerEmail(TENANT)).resolves.toBe('events@dayton.test');
      await expect(svc.supportEmail(TENANT)).resolves.toBe('help@deployment.test');
    });
  });

  describe('with a mail domain on the community', () => {
    // The ordering decision this block exists to pin down. A community that
    // named its own mail domain has said something more specific than the
    // deployment default, so a derivation from it outranks the env var.
    it('outranks a deployment-wide address', async () => {
      const svc = make(
        { mail_domain: 'dayton.test' },
        { SUPPORT_EMAIL: 'help@deployment.test', EVENT_ORGANIZER_EMAIL: 'no@deployment.test' },
      );
      await expect(svc.supportEmail(TENANT)).resolves.toBe('hello@dayton.test');
      await expect(svc.eventOrganizerEmail(TENANT)).resolves.toBe('noreply@dayton.test');
    });

    it('still loses to an explicit address on the same community', async () => {
      const svc = make({ mail_domain: 'dayton.test', contact_support_email: 'ask@dayton.test' });
      await expect(svc.supportEmail(TENANT)).resolves.toBe('ask@dayton.test');
    });

    it('strips a "www." an admin pasted in', async () => {
      // www.<domain> generally publishes no MX record, so an address derived
      // from it bounces silently -- the same trap instance-contact.ts guards.
      const svc = make({ mail_domain: 'WWW.Dayton.test' });
      await expect(svc.mailDomain(TENANT)).resolves.toBe('Dayton.test');
    });

    it('treats a blank row as unset rather than as an empty domain', async () => {
      const svc = make({ mail_domain: '   ' }, { BASE_DOMAIN: 'deployment.test' });
      await expect(svc.supportEmail(TENANT)).resolves.toBe('hello@deployment.test');
    });
  });

  describe('stage prefix', () => {
    // Asks "is this deployment stage", which is true of the process and not of
    // any one community, so it survives the move to per-tenant domains.
    it('applies to a community mail domain too', async () => {
      const svc = make({ mail_domain: 'dayton.test' }, { APP_URL: 'https://stage.example.com' });
      await expect(svc.calendarOrganizerEmail(TENANT)).resolves.toBe('calendar-stage@dayton.test');
    });
  });

  describe('tenant context', () => {
    it('reads the ambient tenant when no id is passed', async () => {
      const svc = make({ contact_support_email: 'ask@dayton.test' });
      await runWithTenant(TENANT, async () => {
        await expect(svc.supportEmail()).resolves.toBe('ask@dayton.test');
      });
    });
  });
});

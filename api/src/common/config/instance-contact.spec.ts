import { ConfigService } from '@nestjs/config';
import {
  baseDomain,
  calendarOrganizerEmail,
  eventOrganizerEmail,
  supportEmail,
} from './instance-contact';

// Minimal stand-in — these helpers only ever call config.get(key, default).
function stubConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string, defaultValue?: string) => values[key] ?? defaultValue,
  } as unknown as ConfigService;
}

describe('instance-contact', () => {
  describe('baseDomain', () => {
    it('uses an explicit BASE_DOMAIN', () => {
      expect(baseDomain(stubConfig({ BASE_DOMAIN: 'sons.example.com' }))).toBe('sons.example.com');
    });

    // The regression: BASE_DOMAIN was previously returned verbatim, so a value
    // carrying "www." produced calendar@www.<domain> — a hostname with no MX
    // record, which bounced every inbound calendar RSVP reply.
    it('strips a leading "www." from an explicit BASE_DOMAIN', () => {
      expect(baseDomain(stubConfig({ BASE_DOMAIN: 'www.dinnerbears.com' }))).toBe(
        'dinnerbears.com',
      );
    });

    it('strips "www." case-insensitively and tolerates surrounding whitespace', () => {
      expect(baseDomain(stubConfig({ BASE_DOMAIN: '  WWW.DinnerBears.com  ' }))).toBe(
        'DinnerBears.com',
      );
    });

    it('does not strip "www" when it is part of a longer label', () => {
      expect(baseDomain(stubConfig({ BASE_DOMAIN: 'wwwtest.example.com' }))).toBe(
        'wwwtest.example.com',
      );
    });

    it("falls back to APP_URL's host, also stripping www.", () => {
      expect(baseDomain(stubConfig({ APP_URL: 'https://www.dinnerbears.com' }))).toBe(
        'dinnerbears.com',
      );
    });

    it('ignores a blank BASE_DOMAIN and falls through to APP_URL', () => {
      expect(baseDomain(stubConfig({ BASE_DOMAIN: '   ', APP_URL: 'https://sons.test' }))).toBe(
        'sons.test',
      );
    });

    it('falls back to the platform domain when APP_URL is unparseable', () => {
      expect(baseDomain(stubConfig({ APP_URL: 'not a url' }))).toBe(
        'communityeventsproject.com',
      );
    });
  });

  describe('derived addresses', () => {
    const wwwProd = { BASE_DOMAIN: 'www.dinnerbears.com', APP_URL: 'https://www.dinnerbears.com' };

    it('builds a deliverable calendar organizer address', () => {
      expect(calendarOrganizerEmail(stubConfig(wwwProd))).toBe('calendar@dinnerbears.com');
    });

    it('builds deliverable support and event-organizer addresses', () => {
      expect(supportEmail(stubConfig(wwwProd))).toBe('hello@dinnerbears.com');
      expect(eventOrganizerEmail(stubConfig(wwwProd))).toBe('noreply@dinnerbears.com');
    });

    it('uses the calendar-stage prefix on a stage host', () => {
      expect(
        calendarOrganizerEmail(stubConfig({ APP_URL: 'https://stage.dinnerbears.com' })),
      ).toBe('calendar-stage@stage.dinnerbears.com');
    });

    // Explicit full-address overrides are respected as typed — deliberately not
    // rewritten, since an operator who sets a whole address means it.
    it('respects explicit address overrides', () => {
      expect(
        calendarOrganizerEmail(stubConfig({ CALENDAR_ORGANIZER_EMAIL: 'rsvp@other.test' })),
      ).toBe('rsvp@other.test');
      expect(supportEmail(stubConfig({ SUPPORT_EMAIL: 'help@other.test' }))).toBe(
        'help@other.test',
      );
    });
  });
});

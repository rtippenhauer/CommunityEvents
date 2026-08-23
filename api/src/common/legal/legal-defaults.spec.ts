import { describe, expect, it } from 'vitest';
import {
  LEGAL_DEFAULT_ROWS,
  LEGAL_PRIVACY_DEFAULT_HTML,
  LEGAL_TERMS_DEFAULT_HTML,
  fillLegalPlaceholders,
} from './legal-defaults';

const values = {
  brandName: 'Dayton Community Events',
  legalEntity: 'Example Holdings, LLC',
  supportEmail: 'hello@example.test',
};

describe('legal defaults', () => {
  it('seeds both public legal pages', () => {
    // /terms and /privacy render whatever app_config holds. A missing row is
    // not an error there -- it is a titled page with nothing under it, which
    // reads as answered.
    expect(LEGAL_DEFAULT_ROWS.map((r) => r.configKey)).toEqual([
      'legal_terms_html',
      'legal_privacy_html',
    ]);
  });

  it('names no particular company', () => {
    // These documents used to be DinnerBears' production copy, inherited by
    // whoever installed this next -- naming DinnerBears.Com, LLC as their
    // operator and Ohio as their governing law.
    for (const { configValue } of LEGAL_DEFAULT_ROWS) {
      expect(configValue.toLowerCase()).not.toContain('dinnerbears');
      expect(configValue).not.toMatch(/\bLLC\b/);
      expect(configValue).toContain('{{legal_entity}}');
    }
  });

  it('says who to contact, without hardcoding an address', () => {
    for (const { configValue } of LEGAL_DEFAULT_ROWS) {
      expect(configValue).toContain('{{support_email}}');
      expect(configValue).not.toMatch(/mailto:[a-z]+@[a-z]/i);
    }
  });

  describe('fillLegalPlaceholders', () => {
    it('fills every placeholder in the shipped copy', () => {
      for (const html of [LEGAL_TERMS_DEFAULT_HTML, LEGAL_PRIVACY_DEFAULT_HTML]) {
        const filled = fillLegalPlaceholders(html, values);

        expect(filled).not.toContain('{{');
        expect(filled).toContain('Dayton Community Events');
        expect(filled).toContain('Example Holdings, LLC');
        expect(filled).toContain('hello@example.test');
      }
    });

    it('tolerates whitespace inside a placeholder', () => {
      // An admin editing in a rich-text editor is one stray keystroke from
      // "{{ brand_name }}", and a placeholder that silently survives to a
      // public page is worse than one that never worked.
      expect(fillLegalPlaceholders('<p>{{ brand_name }}</p>', values)).toBe(
        '<p>Dayton Community Events</p>',
      );
    });

    it('escapes the values it substitutes', () => {
      // The document is admin-authored HTML and deliberately rendered raw; a
      // community name is not, and it comes from a different screen.
      const filled = fillLegalPlaceholders('<p>{{brand_name}}</p>', {
        ...values,
        brandName: '<script>alert(1)</script>',
      });

      expect(filled).not.toContain('<script>');
      expect(filled).toContain('&lt;script&gt;');
    });

    it('leaves hand-written copy alone', () => {
      // A community that replaced the templates outright has no placeholders
      // left, and nothing should be rewritten underneath it.
      const own = '<h2>Our Terms</h2><p>Be decent to each other.</p>';

      expect(fillLegalPlaceholders(own, values)).toBe(own);
    });
  });
});

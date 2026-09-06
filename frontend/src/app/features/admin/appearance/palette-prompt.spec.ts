import { describe, it, expect } from 'vitest';
import { PALETTE_PROMPT, parsePastedPalette } from './palette-prompt';

describe('PALETTE_PROMPT', () => {
  // The prompt and the parser are one contract. If the prompt stops naming the
  // exact JSON shape the parser wants, a correct answer stops importing.
  it('names the shape the parser accepts', () => {
    expect(PALETTE_PROMPT).toContain('"primary"');
    expect(PALETTE_PROMPT).toContain('"accent"');
    expect(PALETTE_PROMPT).toContain('"background"');
    expect(PALETTE_PROMPT).toContain('#RRGGBB');
  });

  it('states the contrast bar the screen will hold the answer to', () => {
    expect(PALETTE_PROMPT).toContain('4.5:1');
  });

  it('leaves a place for the admin to describe their community', () => {
    expect(PALETTE_PROMPT).toContain('The community is:');
  });
});

describe('parsePastedPalette', () => {
  const GOOD = '{"primary":"#4C5BD4","accent":"#6B4BA8","background":"#F7F7FB"}';

  it('reads a clean object', () => {
    const result = parsePastedPalette(GOOD);
    expect(result.ok).toBe(true);
    expect(result.ok && result.seeds).toEqual({
      primary: '#4c5bd4',
      accent: '#6b4ba8',
      background: '#f7f7fb',
    });
  });

  it('tolerates the prose an assistant adds either side', () => {
    // Models add a sentence however firmly the prompt says not to. Handling it
    // is the difference between "paste it" and "paste it, but first delete the
    // bits around it".
    const result = parsePastedPalette(
      `Sure! Here's a palette for a supper club:\n\n${GOOD}\n\nLet me know if you'd like it warmer.`,
    );
    expect(result.ok).toBe(true);
  });

  it('handles a fenced code block', () => {
    const result = parsePastedPalette('```json\n' + GOOD + '\n```');
    expect(result.ok).toBe(true);
  });

  it('is not confused by a brace inside a string', () => {
    const result = parsePastedPalette('{"primary":"#4C5BD4","accent":"#6B4BA8","background":"#F7F7FB","note":"a } brace"}');
    expect(result.ok).toBe(true);
  });

  it('accepts shorthand and bare hex, normalising both', () => {
    const result = parsePastedPalette('{"primary":"#abc","accent":"6B4BA8","background":"#F7F7FB"}');
    expect(result.ok && result.seeds.primary).toBe('#aabbcc');
    expect(result.ok && result.seeds.accent).toBe('#6b4ba8');
  });

  it('rejects what it genuinely cannot use, naming the problem', () => {
    expect(parsePastedPalette('')).toEqual({
      ok: false,
      error: 'Paste the JSON palette first.',
    });
    expect(parsePastedPalette('no braces here').ok).toBe(false);
    expect(parsePastedPalette('{oops}').ok).toBe(false);

    const missing = parsePastedPalette('{"primary":"#4C5BD4","accent":"#6B4BA8"}');
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.error).toContain('background');

    const bad = parsePastedPalette('{"primary":"blue","accent":"#6B4BA8","background":"#F7F7FB"}');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toContain('primary');
  });

  it('accepts a low-contrast palette rather than rejecting it', () => {
    // Warn, do not block — the screen's warnings panel is what tells the admin.
    // Rejecting here would make that warning a lie and lose the preview too.
    const pale = '{"primary":"#FFF8E1","accent":"#FFFDF5","background":"#FFFFFF"}';
    expect(parsePastedPalette(pale).ok).toBe(true);
  });
});

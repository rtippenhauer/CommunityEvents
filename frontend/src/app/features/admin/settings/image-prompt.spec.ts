import { describe, it, expect } from 'vitest';
import { buildImagePrompt, type ImagePromptBrand } from './image-prompt';

const BRAND: ImagePromptBrand = {
  name: 'Dayton Suppers',
  tagline: 'Pull up a chair.',
  colorPrimary: '#4c5bd4',
  colorAccent: '#6b4ba8',
  colorBackground: '#f7f7fb',
  dinnerPluralLower: 'suppers',
};

describe('buildImagePrompt', () => {
  // Each slot line is rendered as `This is ${brief}`, so a brief that opens
  // with a verb produces "This is sits behind the home page welcome". Three
  // did, and shipped. The prompt is pasted verbatim into an image assistant,
  // so this is a defect in the product's output, not a typo in a comment.
  it('renders every slot line as a grammatical sentence', () => {
    const prompt = buildImagePrompt(BRAND);
    const slotLines = prompt.split('\n').filter((l) => /^\d+\. \*\*/.test(l));
    expect(slotLines).toHaveLength(6);
    for (const line of slotLines) {
      const after = line.split('This is ')[1] ?? '';
      expect(after.length, line).toBeGreaterThan(0);
      expect(after, line).not.toMatch(/^(sits|illustrates|shows|appears|goes|holds)\b/);
    }
  });

  // The whole point of generating this rather than storing a constant: a
  // prompt that does not name the community produces artwork for no community
  // in particular, which is the failure brand-mark.util.ts exists to avoid.
  it("carries the community's own identity", () => {
    const prompt = buildImagePrompt(BRAND);
    expect(prompt).toContain('Dayton Suppers');
    expect(prompt).toContain('Pull up a chair.');
    expect(prompt).toContain('suppers');
  });

  it('names all three seed colours', () => {
    const prompt = buildImagePrompt(BRAND);
    expect(prompt).toContain('#4c5bd4');
    expect(prompt).toContain('#6b4ba8');
    expect(prompt).toContain('#f7f7fb');
  });

  // The slot labels are how an admin knows which returned file goes in which
  // uploader, so they have to match the screen word for word. A renamed slot
  // on one side only turns six labelled images into six unlabelled ones.
  it('names every uploadable slot exactly as Site Settings labels it', () => {
    const prompt = buildImagePrompt(BRAND);
    for (const label of [
      'Logo',
      'Icon',
      'Splash',
      'Hero Background',
      'Story Brand Image',
      'Error Page Backdrop',
    ]) {
      expect(prompt).toContain(label);
    }
  });

  it('gives each slot a size, so nothing comes back square by default', () => {
    const prompt = buildImagePrompt(BRAND);
    expect(prompt.match(/\d+x\d+px/g)).toHaveLength(6);
  });
});

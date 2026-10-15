import { compareNoteFiles } from './release-notes-importer.service';

describe('compareNoteFiles', () => {
  it('orders by numeric version, not alphabetically', () => {
    const files = ['1.6.2.md', '1.6.10.md', '1.5.1.md', '1.6.1.md', '1.6.9.md', '2.0.0.md'];
    expect([...files].sort(compareNoteFiles)).toEqual([
      '1.5.1.md',
      '1.6.1.md',
      '1.6.2.md',
      '1.6.9.md',
      '1.6.10.md',
      '2.0.0.md',
    ]);
  });

  it('treats a missing segment as zero', () => {
    expect(compareNoteFiles('1.6.md', '1.6.0.md')).toBe(0);
    expect(compareNoteFiles('1.6.md', '1.6.1.md')).toBeLessThan(0);
  });

  it('falls back to a deterministic string order for non-version names', () => {
    expect(compareNoteFiles('beta.md', 'alpha.md')).toBeGreaterThan(0);
  });
});

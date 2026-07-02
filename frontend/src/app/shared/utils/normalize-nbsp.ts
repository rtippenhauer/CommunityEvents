/**
 * Quill stores non-breaking spaces (U+00A0, sometimes serialized as &nbsp;)
 * in place of regular spaces, which prevents the browser from wrapping the
 * rendered text. Normalize them to regular spaces before saving or rendering
 * rich-text HTML.
 */
export function normalizeNbsp(html: string): string {
  return html.replace(/\u00a0|&nbsp;/g, ' ');
}

/**
 * Pulls the iCalendar block out of a raw inbound email (a calendar client's
 * Accept/Maybe/Decline reply), undoing whatever transfer encoding the sender
 * used. Pure, so the decode rule can be pinned by unit tests without a
 * database -- the rule is the part that has been wrong.
 */
export function extractIcalFromEmail(rawEmail: string): string | null {
  // A readable BEGIN:VCALENDAR does NOT prove the block was never
  // quoted-printable. Most senders that leave the marker readable send clean
  // iCal, and for those only QP soft line breaks may need undoing -- a full
  // hex-escape decode would corrupt them, since "=XY" also matches legitimate
  // iCal whenever X and Y happen to be hex digits ("PARTSTAT=ACCEPTED" contains
  // "=AC", "PARTSTAT=DECLINED" contains "=DE").
  //
  // Gmail is the exception (v1 PR #45): its replies keep BEGIN:VCALENDAR
  // readable and still write every "=" as "=3D" (PARTSTAT=3DACCEPTED). Real QP
  // encodes every "=", so a block containing "=3D" is genuinely encoded and gets
  // the full decode; clean iCal never contains "=3D". Neither "always decode"
  // nor "never decode" is right, which is why branching on it is the rule.
  const inline = rawEmail.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/i);
  if (inline) {
    return /=3D/i.test(inline[0])
      ? decodeQuotedPrintable(inline[0])
      : inline[0].replace(/=\r?\n/g, '');
  }

  // Try after full QP decode of the email (catches cases where the iCal section
  // has soft-line-break folding that obscures the BEGIN: marker)
  const qpDecoded = decodeQuotedPrintable(rawEmail);
  const qpMatch = qpDecoded.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/i);
  if (qpMatch) return qpMatch[0];

  // Base64-encoded MIME part
  const b64Parts =
    rawEmail.match(/Content-Transfer-Encoding:\s*base64[\s\S]*?(?=\n--|\n\n--|$)/gi) ?? [];
  for (const part of b64Parts) {
    const b64 = part.match(/\n\n([\w+/=\r\n]+)/)?.[1];
    if (!b64) continue;
    try {
      const decoded = Buffer.from(b64.replace(/[\r\n]/g, ''), 'base64').toString('utf-8');
      const cal = decoded.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/i);
      if (cal) return cal[0];
    } catch {
      // ignore malformed base64
    }
  }

  return null;
}

/**
 * Escapes are bytes of UTF-8 text, so each run of them is decoded as bytes -- a
 * name like "José" arrives as "Jos=C3=A9", and decoding each escape to its own
 * character would produce "JosÃ©". Only the runs are touched, so text that was
 * never escaped (including any raw non-ASCII) passes through unchanged.
 */
export function decodeQuotedPrintable(str: string): string {
  return str
    .replace(/=\r?\n/g, '') // remove QP soft line breaks
    .replace(/(?:=[0-9A-Fa-f]{2})+/g, (run) =>
      Buffer.from(run.replace(/=/g, ''), 'hex').toString('utf-8'),
    );
}

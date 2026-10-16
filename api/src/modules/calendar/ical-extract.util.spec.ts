import { decodeQuotedPrintable, extractIcalFromEmail } from './ical-extract.util';

// v1 PR #45: Gmail's calendar replies keep BEGIN:VCALENDAR readable but write
// every "=" as "=3D". Clean iCal must not be fully decoded ("=AC" in
// PARTSTAT=ACCEPTED would read as an escape), so the rule branches on "=3D".
describe('extractIcalFromEmail', () => {
  const gmail = [
    'Content-Type: text/calendar; charset="UTF-8"; method=REPLY',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'BEGIN:VCALENDAR',
    'METHOD:REPLY',
    'BEGIN:VEVENT',
    'ATTENDEE;CUTYPE=3DINDIVIDUAL;PARTSTAT=3DACCEPTED;CN=3DLarry Mart=',
    '=C3=ADn;X-NUM-GUESTS=3D0:mailto:larry@example.test',
    'UID:communityevents-event-7@communityeventsproject.com',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  it('fully decodes a readable block that carries =3D escapes', () => {
    const ical = extractIcalFromEmail(gmail)!;
    expect(ical).toContain('PARTSTAT=ACCEPTED;CN=Larry Martín;X-NUM-GUESTS=0:mailto:larry@example.test');
    expect(ical).not.toContain('=3D');
  });

  it('leaves clean iCal alone apart from soft line breaks', () => {
    for (const partstat of ['ACCEPTED', 'DECLINED', 'TENTATIVE']) {
      const raw = `BEGIN:VCALENDAR\r\nATTENDEE;PARTSTAT=${partstat};CN=Pl=\r\nain:mailto:a@example.test\r\nEND:VCALENDAR`;
      expect(extractIcalFromEmail(raw)).toBe(
        `BEGIN:VCALENDAR\r\nATTENDEE;PARTSTAT=${partstat};CN=Plain:mailto:a@example.test\r\nEND:VCALENDAR`,
      );
    }
  });

  it('finds a block whose marker was itself broken by QP folding', () => {
    const raw = 'BEGIN:VCAL=\r\nENDAR\r\nATTENDEE;PARTSTAT=3DTENTATIVE:mailto:a@example.test\r\nEND:VCALENDAR';
    expect(extractIcalFromEmail(raw)).toContain('PARTSTAT=TENTATIVE');
  });

  it('decodes a base64 part', () => {
    const cal = 'BEGIN:VCALENDAR\r\nATTENDEE;PARTSTAT=ACCEPTED:mailto:a@example.test\r\nEND:VCALENDAR';
    const raw = `Content-Transfer-Encoding: base64\n\n${Buffer.from(cal).toString('base64')}\n--b1--`;
    expect(extractIcalFromEmail(raw)).toBe(cal);
  });

  it('returns null when there is no calendar block', () => {
    expect(extractIcalFromEmail('hello')).toBeNull();
  });
});

describe('decodeQuotedPrintable', () => {
  it('decodes escapes as UTF-8 bytes', () => {
    expect(decodeQuotedPrintable('Jos=C3=A9')).toBe('José');
  });

  it('leaves unescaped non-ASCII text untouched', () => {
    expect(decodeQuotedPrintable('Martín =3D café')).toBe('Martín = café');
  });
});

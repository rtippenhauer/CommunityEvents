import { describe, expect, it, vi } from 'vitest';
import { readAttachments } from './queue-attachments.util';

/**
 * `v2-50`. The column this reads did not exist until that item: `queue()` took
 * `attachments` on its DTO and dropped them on the floor, so every queued
 * calendar invite was sent without its invite and the queue row looked
 * correct. These cover the reading half -- the e2e suite covers the round
 * trip.
 */
describe('readAttachments', () => {
  const logger = () => ({ warn: vi.fn() });

  it('reads back what queue() stored', () => {
    const stored = [
      { content: 'BEGIN:VCALENDAR', name: 'dinner-invite.ics', contentType: 'text/calendar' },
    ];
    expect(readAttachments(stored, 1)).toEqual(stored);
  });

  // NULL is the common case by a wide margin -- every message with no
  // attachment, plus every row written before the column existed.
  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('treats %s as no attachments', (_label, value) => {
    expect(readAttachments(value, 1)).toBeUndefined();
  });

  it('keeps an entry without a contentType rather than inventing one', () => {
    const stored = [{ content: 'x', name: 'a.ics' }];
    expect(readAttachments(stored, 1)).toEqual([{ content: 'x', name: 'a.ics' }]);
  });

  it('drops a malformed entry and keeps its usable siblings', () => {
    const log = logger();
    const result = readAttachments(
      [{ content: 'good', name: 'a.ics' }, { name: 'no-content.ics' }, null, 'a string'],
      7,
      log,
    );

    expect(result).toEqual([{ content: 'good', name: 'a.ics' }]);
    expect(log.warn).toHaveBeenCalledTimes(3);
  });

  /**
   * The failure this guards is specific: a cast would hand the provider a
   * payload built from `undefined.name`, the send would throw, and the
   * dispatcher would record a send failure and retry a row that can never
   * succeed -- four more attempts, each a provider call, for a message whose
   * body was perfectly deliverable.
   */
  it('sends the message without its attachment when the value is not an array', () => {
    const log = logger();
    expect(readAttachments({ content: 'x', name: 'a.ics' }, 9, log)).toBeUndefined();
    expect(log.warn).toHaveBeenCalledOnce();
  });

  // The providers branch on `attachments?.length`, so an empty array would read
  // as "deliberately none" -- the same outcome reached less honestly.
  it('reports an array with nothing usable in it as no attachments', () => {
    expect(readAttachments([], 1)).toBeUndefined();
    expect(readAttachments([{ nope: true }], 1, logger())).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import { generateIcs, escapeIcsText, foldIcsLine, exclusiveEndDateValue } from './ics';
import { generateIcs as generateIcsShared } from '../../supabase/functions/_shared/ics.ts';

const NOW = new Date('2026-09-17T10:15:30Z');

function lines(ics: string): string[] {
  // Split on CRLF only: a bare LF anywhere would mean we emitted a bad line end.
  expect(ics.includes('\n')).toBe(true);
  expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
  return ics.slice(0, -2).split('\r\n');
}

/** Undo folding so a value can be asserted as one logical line. */
function unfold(ics: string): string {
  return ics.replace(/\r\n /g, '');
}

describe('escapeIcsText', () => {
  it('escapes backslash, semicolon, comma and newlines', () => {
    expect(escapeIcsText('a,b;c\\d')).toBe('a\\,b\\;c\\\\d');
    expect(escapeIcsText('one\ntwo')).toBe('one\\ntwo');
    expect(escapeIcsText('one\r\ntwo')).toBe('one\\ntwo');
  });

  it('escapes the backslash first so added escapes are not double-escaped', () => {
    expect(escapeIcsText('\\,')).toBe('\\\\\\,');
  });

  it('leaves plain text alone', () => {
    expect(escapeIcsText('Sprint planning')).toBe('Sprint planning');
  });
});

describe('foldIcsLine', () => {
  it('leaves lines of 75 octets or fewer untouched', () => {
    const line = 'X'.repeat(75);
    expect(foldIcsLine(line)).toBe(line);
  });

  it('folds longer lines with a leading space on continuations', () => {
    const folded = foldIcsLine('Y'.repeat(200));
    const parts = folded.split('\r\n');
    expect(parts[0]).toHaveLength(75);
    expect(parts.slice(1).every(p => p.startsWith(' '))).toBe(true);
    // Every physical line, including its leading space, fits the 75-octet limit.
    expect(parts.every(p => p.length <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe('Y'.repeat(200));
  });

  it('counts octets, not characters, and never splits a character', () => {
    // "é" is 2 octets in UTF-8, so 40 of them exceed the 75-octet budget.
    const folded = foldIcsLine('é'.repeat(60));
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    const enc = new TextEncoder();
    expect(parts.every(p => enc.encode(p).length <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe('é'.repeat(60));
    expect(folded).not.toContain('�');
  });
});

describe('exclusiveEndDateValue', () => {
  it('adds one day', () => {
    expect(exclusiveEndDateValue('2026-09-17')).toBe('20260918');
  });

  it('rolls over month and year boundaries', () => {
    expect(exclusiveEndDateValue('2026-09-30')).toBe('20261001');
    expect(exclusiveEndDateValue('2026-12-31')).toBe('20270101');
  });

  it('handles a leap day', () => {
    expect(exclusiveEndDateValue('2028-02-28')).toBe('20280229');
    expect(exclusiveEndDateValue('2028-02-29')).toBe('20280301');
  });
});

describe('generateIcs', () => {
  const basic = () =>
    generateIcs({
      calendarName: 'Swimlanes — Team',
      now: NOW,
      events: [
        {
          uid: 'block-1@swimlanes',
          title: 'Sprint planning',
          start: '2026-09-17',
          end: '2026-09-19',
        },
      ],
    });

  it('wraps the events in a VCALENDAR with PRODID and X-WR-CALNAME', () => {
    const out = lines(basic());
    expect(out[0]).toBe('BEGIN:VCALENDAR');
    expect(out).toContain('VERSION:2.0');
    expect(out).toContain('PRODID:-//Swimlanes//Sprint Board//EN');
    expect(out).toContain('CALSCALE:GREGORIAN');
    expect(out).toContain('X-WR-CALNAME:Swimlanes — Team');
    expect(out[out.length - 1]).toBe('END:VCALENDAR');
  });

  it('writes all-day events with an exclusive DTEND', () => {
    const out = lines(basic());
    expect(out).toContain('DTSTART;VALUE=DATE:20260917');
    // The block's last day is the 19th, so DTEND is the 20th.
    expect(out).toContain('DTEND;VALUE=DATE:20260920');
    expect(out).toContain('SUMMARY:Sprint planning');
    expect(out).toContain('UID:block-1@swimlanes');
  });

  it('stamps every event with the supplied `now`, so output is deterministic', () => {
    const first = basic();
    const second = basic();
    expect(first).toBe(second);
    expect(first).toContain('DTSTAMP:20260917T101530Z');
  });

  it('ends every line with CRLF, including the last', () => {
    const ics = basic();
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(/(?<!\r)\n/.test(ics)).toBe(false);
  });

  it('escapes text values and folds long ones', () => {
    const ics = generateIcs({
      calendarName: 'Team; and, others',
      now: NOW,
      events: [
        {
          uid: 'block-2@swimlanes',
          title: `Rewrite ${'the billing importer '.repeat(5)}, carefully; twice`,
          start: '2026-01-01',
          end: '2026-01-01',
          description: 'Line one\nLine two',
        },
      ],
    });

    expect(ics).toContain('X-WR-CALNAME:Team\\; and\\, others');
    const unfolded = unfold(ics);
    expect(unfolded).toContain('DESCRIPTION:Line one\\nLine two');
    expect(unfolded).toContain('\\, carefully\\; twice');
    // The long SUMMARY must have been folded into continuation lines.
    expect(ics).toMatch(/SUMMARY:[^\r\n]+\r\n /);
    expect(ics.split('\r\n').every(l => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });

  it('omits DESCRIPTION when there is none', () => {
    expect(basic()).not.toContain('DESCRIPTION');
  });

  it('writes one VEVENT per event and none for an empty calendar', () => {
    const empty = generateIcs({ calendarName: 'Nobody', now: NOW, events: [] });
    expect(empty).not.toContain('BEGIN:VEVENT');
    expect(lines(empty)).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Swimlanes//Sprint Board//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Nobody',
      'END:VCALENDAR',
    ]);

    const two = generateIcs({
      calendarName: 'Two',
      now: NOW,
      events: [
        { uid: 'a', title: 'A', start: '2026-03-02', end: '2026-03-02' },
        { uid: 'b', title: 'B', start: '2026-03-03', end: '2026-03-06' },
      ],
    });
    expect(two.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(two.match(/END:VEVENT/g)).toHaveLength(2);
  });

  it('is a single-day event when start and end are the same day', () => {
    const out = lines(
      generateIcs({
        calendarName: 'One day',
        now: NOW,
        events: [{ uid: 'x', title: 'Standup', start: '2026-05-04', end: '2026-05-04' }],
      }),
    );
    expect(out).toContain('DTSTART;VALUE=DATE:20260504');
    expect(out).toContain('DTEND;VALUE=DATE:20260505');
  });
});

describe('the edge function copy in supabase/functions/_shared/ics.ts', () => {
  it('produces byte-identical output to src/lib/ics.ts', () => {
    const fixture = {
      calendarName: 'Swimlanes — Team; all, members',
      now: NOW,
      events: [
        {
          uid: 'a1@swimlanes',
          title: `Ada: ${'a very long block title '.repeat(4)}`,
          start: '2026-09-17',
          end: '2026-09-30',
          description: 'Notes: one\ntwo; three, four\\five',
        },
        { uid: 'b2@swimlanes', title: 'Grace: réview', start: '2026-12-31', end: '2026-12-31' },
      ],
    };
    expect(generateIcsShared(fixture)).toBe(generateIcs(fixture));
  });
});

/**
 * Minimal RFC 5545 (iCalendar) writer for all-day events.
 *
 * THIS IS A COPY of `src/lib/ics.ts`, kept here because a Deno edge function
 * cannot import from the Vite app's source tree. It is dependency-free and
 * side-effect-free so both copies stay portable; `src/lib/ics.test.ts` imports
 * both and asserts they produce identical output for a fixture.
 */

export interface IcsEvent {
  /** Globally unique id for the event (RFC 5545 UID) */
  uid: string;
  /** SUMMARY — the text shown in the calendar */
  title: string;
  /** First day, inclusive, as "yyyy-MM-dd" */
  start: string;
  /** Last day, INCLUSIVE, as "yyyy-MM-dd" (DTEND is written as end + 1 day) */
  end: string;
  description?: string;
}

export interface IcsOptions {
  /** X-WR-CALNAME — the name most clients show for the calendar */
  calendarName: string;
  events: IcsEvent[];
  /** Timestamp written as DTSTAMP; injectable so output is deterministic. */
  now?: Date;
  prodId?: string;
}

const DEFAULT_PROD_ID = '-//Swimlanes//Sprint Board//EN';

/** Max octets per content line, excluding the CRLF (RFC 5545 s3.1). */
const LINE_OCTETS = 75;

const encoder = new TextEncoder();

function octets(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Escape a TEXT value: backslash first (so the escapes we add are not escaped
 * again), then the structural characters, then newlines.
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Fold a content line to 75 octets, continuation lines starting with one
 * space. Splits on code points (never inside a character) and counts UTF-8
 * bytes, not JS string units.
 */
export function foldIcsLine(line: string): string {
  if (octets(line) <= LINE_OCTETS) return line;

  const parts: string[] = [];
  let current = '';
  let used = 0;
  // The first line has the full budget; every later one spends one octet on
  // the leading space that marks it as a continuation.
  let budget = LINE_OCTETS;

  for (const char of line) {
    const size = octets(char);
    if (used + size > budget) {
      parts.push(current);
      current = '';
      used = 0;
      budget = LINE_OCTETS - 1;
    }
    current += char;
    used += size;
  }
  parts.push(current);

  return parts.join('\r\n ');
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "yyyy-MM-dd" -> "yyyyMMdd" */
function toDateValue(iso: string): string {
  return iso.replace(/-/g, '');
}

/**
 * DTEND on an all-day event is exclusive, so a block ending on its last day
 * needs the day after. Done in UTC so no local timezone can shift the date.
 */
export function exclusiveEndDateValue(inclusiveEnd: string): string {
  const [year, month, day] = inclusiveEnd.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}${pad2(next.getUTCMonth() + 1)}${pad2(next.getUTCDate())}`;
}

/** UTC date-time value, e.g. "20260917T101530Z" */
function toDateTimeValue(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}` +
    `T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`
  );
}

/** Build an iCalendar document of all-day events. Lines end with CRLF. */
export function generateIcs(options: IcsOptions): string {
  const { calendarName, events } = options;
  const stamp = toDateTimeValue(options.now ?? new Date());

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${escapeIcsText(options.prodId ?? DEFAULT_PROD_ID)}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
  ];

  for (const event of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeIcsText(event.uid)}`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${toDateValue(event.start)}`);
    lines.push(`DTEND;VALUE=DATE:${exclusiveEndDateValue(event.end)}`);
    lines.push(`SUMMARY:${escapeIcsText(event.title)}`);
    if (event.description !== undefined && event.description !== '') {
      lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
    }
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  // A trailing CRLF keeps the last line terminated, as RFC 5545 requires.
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

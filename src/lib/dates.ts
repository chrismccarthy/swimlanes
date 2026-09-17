import {
  format,
  parseISO,
  addDays,
  addMonths,
  startOfMonth,
  startOfWeek,
  differenceInCalendarDays,
  isWeekend as dfIsWeekend,
} from 'date-fns';

export function isoToday(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

export function addDaysToISO(date: string, days: number): string {
  return format(addDays(parseISO(date), days), 'yyyy-MM-dd');
}

export function daysBetween(a: string, b: string): number {
  return differenceInCalendarDays(parseISO(b), parseISO(a));
}

export function isWeekend(date: string): boolean {
  return dfIsWeekend(parseISO(date));
}

export function formatDayLabel(date: string, prevDate: string | null): string {
  const d = parseISO(date);
  if (!prevDate || format(d, 'M') !== format(parseISO(prevDate), 'M')) {
    return format(d, 'MMM d');
  }
  return format(d, 'd');
}

export function formatFullDate(date: string): string {
  return format(parseISO(date), 'EEE, MMM d yyyy');
}

export function getDayOfWeek(date: string): string {
  return format(parseISO(date), 'EEE');
}

/** ISO date of the Monday on or before `date` */
export function startOfWeekISO(date: string): string {
  return format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

/** ISO date of the first of the month containing `date` */
export function startOfMonthISO(date: string): string {
  return format(startOfMonth(parseISO(date)), 'yyyy-MM-dd');
}

export function addMonthsToISO(date: string, months: number): string {
  return format(addMonths(parseISO(date), months), 'yyyy-MM-dd');
}

/** Label for a week column, e.g. "Sep 1" */
export function formatWeekLabel(date: string): string {
  return format(parseISO(date), 'MMM d');
}

/** Label for a month column, e.g. "Sep 2026" */
export function formatMonthLabel(date: string): string {
  return format(parseISO(date), 'MMM yyyy');
}

/** Generate an array of ISO date strings from startDate for `count` days */
export function generateDateRange(startDate: string, count: number): string[] {
  const dates: string[] = [];
  for (let i = 0; i < count; i++) {
    dates.push(addDaysToISO(startDate, i));
  }
  return dates;
}

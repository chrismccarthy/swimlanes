import { format, parseISO, addDays, differenceInCalendarDays, isWeekend as dfIsWeekend } from 'date-fns';

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

/** Generate an array of ISO date strings from startDate for `count` days */
export function generateDateRange(startDate: string, count: number): string[] {
  const dates: string[] = [];
  for (let i = 0; i < count; i++) {
    dates.push(addDaysToISO(startDate, i));
  }
  return dates;
}

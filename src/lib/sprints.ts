import { daysBetween, addDaysToISO } from './dates';
import type { SprintBoundary } from '../types';

/**
 * Compute sprint boundaries visible in a date range.
 *
 * Given an anchor date (a known sprint start) and sprint length,
 * find the first sprint that overlaps with `fromDate` and generate
 * boundaries forward through `toDate`.
 */
export function computeSprintBoundaries(
  fromDate: string,
  toDate: string,
  anchor: string,
  lengthDays: number
): SprintBoundary[] {
  const boundaries: SprintBoundary[] = [];

  // Find the sprint start that is at or before fromDate
  const offsetFromAnchor = daysBetween(anchor, fromDate);
  // Floor division: walk back to find the sprint containing fromDate
  const sprintOffset = Math.floor(offsetFromAnchor / lengthDays);
  let currentStart = addDaysToISO(anchor, sprintOffset * lengthDays);

  // If currentStart is after fromDate (rounding issue), go back one sprint
  if (currentStart > fromDate) {
    currentStart = addDaysToISO(currentStart, -lengthDays);
  }

  // Generate sprints forward until we pass toDate
  let sprintNumber = 1;
  while (currentStart <= toDate) {
    const endDate = addDaysToISO(currentStart, lengthDays - 1);
    boundaries.push({
      sprintNumber,
      startDate: currentStart,
      endDate,
    });
    currentStart = addDaysToISO(currentStart, lengthDays);
    sprintNumber++;
  }

  return boundaries;
}

/**
 * Get the sprint number for today relative to the sprint containing today.
 * Sprint 1 = the sprint that contains `today`.
 */
export function getSprintLabel(
  sprintStartDate: string,
  today: string,
  anchor: string,
  lengthDays: number
): string {
  const todayOffset = daysBetween(anchor, today);
  const todaySprintOffset = Math.floor(todayOffset / lengthDays);

  const sprintStartOffset = daysBetween(anchor, sprintStartDate);
  const thisSprintOffset = Math.floor(sprintStartOffset / lengthDays);

  const relativeNumber = thisSprintOffset - todaySprintOffset + 1;

  if (relativeNumber === 1) return 'Current Sprint';
  if (relativeNumber < 1) return `Sprint ${relativeNumber}`;  // past sprints: -1, -2...
  return `Sprint +${relativeNumber - 1}`;  // future sprints: +1, +2...
}

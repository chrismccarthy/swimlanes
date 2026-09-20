/**
 * Capacity maths: how much of each sprint is already committed.
 *
 * A member's *available* days are the days of the sprint itself (weekdays only
 * unless told otherwise); their *committed* days are the block-days that fall
 * inside the sprint, summed across blocks. Parallel blocks are counted
 * separately on purpose — a load above 1 is exactly the signal this view
 * exists to surface, not something to clamp away.
 */
import { daysBetween } from './dates';
import type { Block, Member, SprintBoundary } from '../types';

/** How a load reads: comfortable, nearly full, or overcommitted. */
export type LoadLevel = 'ok' | 'high' | 'over';

export interface CapacityFigure {
  /** Block-days inside the sprint (sum across the member's blocks). */
  committedDays: number;
  /** Days the sprint offers — weekdays only unless `workingDaysOnly` is false. */
  availableDays: number;
  /** committedDays / availableDays; 0 when there is no capacity at all. */
  load: number;
}

export interface SprintCapacity {
  sprint: SprintBoundary;
  /** One figure per member passed in, keyed by member id. */
  byMemberId: Map<string, CapacityFigure>;
  /** Roll-up: summed committed over summed available across all members. */
  team: CapacityFigure;
}

export interface CapacityResult {
  /** One entry per input sprint, in the order they were given. */
  sprints: SprintCapacity[];
  /** The same entries, keyed by `sprint.startDate`. */
  bySprintStart: Map<string, SprintCapacity>;
}

/** The part of a member this module needs. */
export type CapacityMember = Pick<Member, 'id'>;
/** The part of a block this module needs. */
export type CapacityBlock = Pick<Block, 'memberId' | 'startDate' | 'endDate'>;

export interface CapacityInput {
  members: CapacityMember[];
  blocks: CapacityBlock[];
  sprints: SprintBoundary[];
  /** When false, weekends count as capacity too. Defaults to true. */
  workingDaysOnly?: boolean;
}

/** Load at or above this reads as "nearly full". */
export const HIGH_LOAD = 0.8;
/** Load above this reads as "overcommitted". */
export const OVER_LOAD = 1.0;

/**
 * A known Sunday. Weekday counting is pure integer maths off this reference,
 * which keeps `computeCapacity` free of per-day date parsing — it runs on
 * every timeline render, including during a drag.
 */
const REFERENCE_SUNDAY = '2024-01-07';

/** 0 = Sunday ... 6 = Saturday. */
function dayOfWeek(date: string): number {
  return ((daysBetween(REFERENCE_SUNDAY, date) % 7) + 7) % 7;
}

/**
 * Days in an inclusive date range, counting weekdays only by default.
 * An inverted range (end before start) is empty.
 */
export function countDays(startDate: string, endDate: string, workingDaysOnly = true): number {
  const span = daysBetween(startDate, endDate) + 1;
  if (span <= 0) return 0;
  if (!workingDaysOnly) return span;

  const startDow = dayOfWeek(startDate);
  const wholeWeeks = Math.floor(span / 7);
  let count = wholeWeeks * 5;
  for (let i = wholeWeeks * 7; i < span; i++) {
    const dow = (startDow + i) % 7;
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

function ratio(committed: number, available: number): number {
  return available > 0 ? committed / available : 0;
}

/** Per-sprint, per-member commitment against the days each sprint offers. */
export function computeCapacity({
  members,
  blocks,
  sprints,
  workingDaysOnly = true,
}: CapacityInput): CapacityResult {
  const blocksByMember = new Map<string, CapacityBlock[]>();
  for (const member of members) blocksByMember.set(member.id, []);
  for (const block of blocks) {
    // Blocks belonging to someone who is not on the board are not capacity.
    blocksByMember.get(block.memberId)?.push(block);
  }

  const sprintCapacities = sprints.map<SprintCapacity>(sprint => {
    const availableDays = countDays(sprint.startDate, sprint.endDate, workingDaysOnly);
    const byMemberId = new Map<string, CapacityFigure>();
    let teamCommitted = 0;

    for (const member of members) {
      let committedDays = 0;
      for (const block of blocksByMember.get(member.id) ?? []) {
        // Clip the block to the sprint — a block straddling the boundary only
        // commits the part of itself that lands inside it.
        const start = block.startDate > sprint.startDate ? block.startDate : sprint.startDate;
        const end = block.endDate < sprint.endDate ? block.endDate : sprint.endDate;
        committedDays += countDays(start, end, workingDaysOnly);
      }
      teamCommitted += committedDays;
      byMemberId.set(member.id, {
        committedDays,
        availableDays,
        load: ratio(committedDays, availableDays),
      });
    }

    const teamAvailable = availableDays * members.length;
    return {
      sprint,
      byMemberId,
      team: {
        committedDays: teamCommitted,
        availableDays: teamAvailable,
        load: ratio(teamCommitted, teamAvailable),
      },
    };
  });

  return {
    sprints: sprintCapacities,
    bySprintStart: new Map(sprintCapacities.map(s => [s.sprint.startDate, s])),
  };
}

/** One member's figures across every sprint, keyed by sprint start date. */
export function memberFigures(
  result: CapacityResult,
  memberId: string
): Map<string, CapacityFigure> {
  const figures = new Map<string, CapacityFigure>();
  for (const sprintCapacity of result.sprints) {
    const figure = sprintCapacity.byMemberId.get(memberId);
    if (figure) figures.set(sprintCapacity.sprint.startDate, figure);
  }
  return figures;
}

/** How a load should be coloured. */
export function loadLevel(load: number): LoadLevel {
  if (load > OVER_LOAD) return 'over';
  if (load >= HIGH_LOAD) return 'high';
  return 'ok';
}

/** The figure as it is shown on the board, e.g. `7 / 10 d`. */
export function formatCapacityDays(figure: CapacityFigure): string {
  return `${figure.committedDays} / ${figure.availableDays} d`;
}

/** The figure as a rounded percentage, e.g. `70%`. */
export function formatLoadPercent(load: number): string {
  return `${Math.round(load * 100)}%`;
}

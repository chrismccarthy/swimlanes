import { describe, it, expect } from 'vitest';
import {
  computeCapacity,
  countDays,
  formatCapacityDays,
  formatLoadPercent,
  loadLevel,
  memberFigures,
} from './capacity';
import { isWeekend, addDaysToISO } from './dates';
import type { Block, Member, SprintBoundary } from '../types';

// Sprint A runs Thu 2026-09-03 through Wed 2026-09-16 — 14 days, 10 weekdays.
const SPRINT_A: SprintBoundary = {
  sprintNumber: 1,
  startDate: '2026-09-03',
  endDate: '2026-09-16',
};
// Sprint B is the next one along, Thu 2026-09-17 through Wed 2026-09-30.
const SPRINT_B: SprintBoundary = {
  sprintNumber: 2,
  startDate: '2026-09-17',
  endDate: '2026-09-30',
};

function member(id: string): Member {
  return { id, boardId: 'board-1', name: id, sortOrder: 1, updatedAt: '' };
}

function block(memberId: string, startDate: string, endDate: string): Block {
  return {
    id: `${memberId}-${startDate}-${endDate}`,
    boardId: 'board-1',
    memberId,
    title: 'work',
    startDate,
    endDate,
    color: 'blue',
    tags: [],
    updatedAt: '',
  };
}

/** The figure for one member in one sprint, asserted to exist. */
function figureFor(
  result: ReturnType<typeof computeCapacity>,
  sprint: SprintBoundary,
  memberId: string
) {
  const figure = result.bySprintStart.get(sprint.startDate)?.byMemberId.get(memberId);
  expect(figure, `figure for ${memberId} in ${sprint.startDate}`).toBeDefined();
  return figure!;
}

describe('countDays', () => {
  it('counts every day of an inclusive range when weekends count', () => {
    expect(countDays('2026-09-03', '2026-09-16', false)).toBe(14);
    expect(countDays('2026-09-03', '2026-09-03', false)).toBe(1);
  });

  it('counts only weekdays by default', () => {
    expect(countDays('2026-09-03', '2026-09-16')).toBe(10);
    // Mon through Fri
    expect(countDays('2026-09-07', '2026-09-11')).toBe(5);
    // Sat + Sun
    expect(countDays('2026-09-05', '2026-09-06')).toBe(0);
  });

  it('is empty for an inverted range', () => {
    expect(countDays('2026-09-10', '2026-09-09')).toBe(0);
    expect(countDays('2026-09-10', '2026-09-09', false)).toBe(0);
  });

  it('agrees with isWeekend day by day across several weeks', () => {
    const start = '2026-08-24';
    let expected = 0;
    for (let i = 0; i < 40; i++) {
      const date = addDaysToISO(start, i);
      if (!isWeekend(date)) expected++;
      expect(countDays(start, date)).toBe(expected);
    }
  });
});

describe('loadLevel', () => {
  it('splits ok / high / over at 0.8 and 1.0', () => {
    expect(loadLevel(0)).toBe('ok');
    expect(loadLevel(0.79)).toBe('ok');
    expect(loadLevel(0.8)).toBe('high');
    expect(loadLevel(1)).toBe('high');
    expect(loadLevel(1.0001)).toBe('over');
    expect(loadLevel(1.5)).toBe('over');
  });
});

describe('computeCapacity', () => {
  it('reports a sprint of weekdays as available capacity', () => {
    const result = computeCapacity({
      members: [member('alice')],
      blocks: [],
      sprints: [SPRINT_A],
    });
    const alice = figureFor(result, SPRINT_A, 'alice');
    expect(alice).toEqual({ committedDays: 0, availableDays: 10, load: 0 });
  });

  it('counts a member with no blocks as fully available', () => {
    const result = computeCapacity({
      members: [member('alice'), member('bob')],
      blocks: [block('alice', '2026-09-07', '2026-09-11')],
      sprints: [SPRINT_A],
    });
    expect(figureFor(result, SPRINT_A, 'alice').committedDays).toBe(5);
    expect(figureFor(result, SPRINT_A, 'bob')).toEqual({
      committedDays: 0,
      availableDays: 10,
      load: 0,
    });
  });

  it('clips a block that straddles a sprint boundary to each sprint', () => {
    // Mon 14th through Fri 18th: 3 weekdays in sprint A, 2 in sprint B.
    const result = computeCapacity({
      members: [member('alice')],
      blocks: [block('alice', '2026-09-14', '2026-09-18')],
      sprints: [SPRINT_A, SPRINT_B],
    });
    expect(figureFor(result, SPRINT_A, 'alice').committedDays).toBe(3);
    expect(figureFor(result, SPRINT_B, 'alice').committedDays).toBe(2);
  });

  it('ignores a block that falls entirely outside the sprint', () => {
    const result = computeCapacity({
      members: [member('alice')],
      blocks: [block('alice', '2026-08-03', '2026-08-07')],
      sprints: [SPRINT_A],
    });
    expect(figureFor(result, SPRINT_A, 'alice').committedDays).toBe(0);
  });

  it('commits nothing for a weekend-only block', () => {
    const result = computeCapacity({
      members: [member('alice')],
      blocks: [block('alice', '2026-09-05', '2026-09-06')],
      sprints: [SPRINT_A],
    });
    expect(figureFor(result, SPRINT_A, 'alice')).toEqual({
      committedDays: 0,
      availableDays: 10,
      load: 0,
    });
  });

  it('counts parallel blocks separately, so load can exceed 1', () => {
    const result = computeCapacity({
      members: [member('alice')],
      blocks: [
        block('alice', '2026-09-07', '2026-09-11'), // 5 weekdays
        block('alice', '2026-09-03', '2026-09-16'), // the whole sprint, 10 weekdays
      ],
      sprints: [SPRINT_A],
    });
    const alice = figureFor(result, SPRINT_A, 'alice');
    expect(alice.committedDays).toBe(15);
    expect(alice.load).toBe(1.5);
    expect(loadLevel(alice.load)).toBe('over');
  });

  it('rolls the team up as summed committed over summed available', () => {
    const result = computeCapacity({
      members: [member('alice'), member('bob')],
      blocks: [
        block('alice', '2026-09-07', '2026-09-11'), // 5
        block('bob', '2026-09-14', '2026-09-16'), // 3
      ],
      sprints: [SPRINT_A],
    });
    const team = result.bySprintStart.get(SPRINT_A.startDate)!.team;
    expect(team).toEqual({ committedDays: 8, availableDays: 20, load: 8 / 20 });
  });

  it('returns a zeroed team roll-up when there are no members', () => {
    const result = computeCapacity({
      members: [],
      blocks: [block('ghost', '2026-09-07', '2026-09-11')],
      sprints: [SPRINT_A],
    });
    const sprint = result.bySprintStart.get(SPRINT_A.startDate)!;
    expect(sprint.byMemberId.size).toBe(0);
    expect(sprint.team).toEqual({ committedDays: 0, availableDays: 0, load: 0 });
  });

  it('ignores blocks belonging to someone who is not on the board', () => {
    const result = computeCapacity({
      members: [member('alice')],
      blocks: [
        block('alice', '2026-09-07', '2026-09-11'),
        block('departed', '2026-09-07', '2026-09-11'),
      ],
      sprints: [SPRINT_A],
    });
    expect(result.bySprintStart.get(SPRINT_A.startDate)!.team.committedDays).toBe(5);
  });

  it('counts weekends as capacity when workingDaysOnly is false', () => {
    const result = computeCapacity({
      members: [member('alice')],
      blocks: [
        block('alice', '2026-09-05', '2026-09-06'), // the weekend
        block('alice', '2026-09-07', '2026-09-11'), // Mon-Fri
      ],
      sprints: [SPRINT_A],
      workingDaysOnly: false,
    });
    expect(figureFor(result, SPRINT_A, 'alice')).toEqual({
      committedDays: 7,
      availableDays: 14,
      load: 7 / 14,
    });
  });

  it('keeps sprints in the order they were given and keys them by start date', () => {
    const result = computeCapacity({
      members: [member('alice')],
      blocks: [],
      sprints: [SPRINT_A, SPRINT_B],
    });
    expect(result.sprints.map(s => s.sprint.startDate)).toEqual([
      SPRINT_A.startDate,
      SPRINT_B.startDate,
    ]);
    expect(result.bySprintStart.get(SPRINT_B.startDate)!.sprint).toBe(SPRINT_B);
  });
});

describe('memberFigures', () => {
  it('pulls one member out across every sprint, keyed by sprint start', () => {
    const result = computeCapacity({
      members: [member('alice'), member('bob')],
      blocks: [block('alice', '2026-09-14', '2026-09-18')],
      sprints: [SPRINT_A, SPRINT_B],
    });
    const figures = memberFigures(result, 'alice');
    expect([...figures.keys()]).toEqual([SPRINT_A.startDate, SPRINT_B.startDate]);
    expect(figures.get(SPRINT_A.startDate)!.committedDays).toBe(3);
    expect(figures.get(SPRINT_B.startDate)!.committedDays).toBe(2);
  });

  it('is empty for someone who is not on the board', () => {
    const result = computeCapacity({
      members: [member('alice')],
      blocks: [],
      sprints: [SPRINT_A],
    });
    expect(memberFigures(result, 'nobody').size).toBe(0);
  });
});

describe('formatting', () => {
  it('formats days as "7 / 10 d"', () => {
    expect(formatCapacityDays({ committedDays: 7, availableDays: 10, load: 0.7 })).toBe('7 / 10 d');
  });

  it('rounds the load to whole percent', () => {
    expect(formatLoadPercent(0)).toBe('0%');
    expect(formatLoadPercent(0.7)).toBe('70%');
    expect(formatLoadPercent(1.5)).toBe('150%');
    expect(formatLoadPercent(0.333)).toBe('33%');
  });
});

import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { computeSprintBoundaries } from '../lib/sprints';
import { computeCapacity, memberFigures } from '../lib/capacity';
import type { CapacityFigure } from '../lib/capacity';
import { daysBetween, isoToday } from '../lib/dates';
import type { SprintBoundary } from '../types';

/**
 * Store-bound views of `src/lib/capacity.ts`. Each hook returns null while the
 * capacity view is off, so a caller renders nothing without a second flag.
 *
 * The sprint list always comes from `computeSprintBoundaries` over the
 * rendered range — the same call, on the same store values, that the timeline
 * header uses for its bands — so lane figures line up with the bands above
 * them at every zoom level.
 */

/** Team totals per sprint for a sprint list the caller already has. */
export function useTeamCapacity(
  sprints: SprintBoundary[]
): Map<string, CapacityFigure> | null {
  const enabled = useAppStore(s => s.capacityEnabled);
  const members = useAppStore(s => s.members);
  const blocks = useAppStore(s => s.blocks);

  return useMemo(() => {
    if (!enabled) return null;
    const result = computeCapacity({ members, blocks, sprints });
    return new Map(result.sprints.map(s => [s.sprint.startDate, s.team]));
  }, [enabled, members, blocks, sprints]);
}

export interface MemberCapacityStrip {
  sprints: SprintBoundary[];
  /** This member's figure per sprint, keyed by sprint start date. */
  figures: Map<string, CapacityFigure>;
  totalDays: number;
}

/** Everything a swim lane's capacity strip needs, or null when the view is off. */
export function useMemberCapacityStrip(memberId: string): MemberCapacityStrip | null {
  const enabled = useAppStore(s => s.capacityEnabled);
  const blocks = useAppStore(s => s.blocks);
  const renderStartDate = useAppStore(s => s.renderStartDate);
  const renderEndDate = useAppStore(s => s.renderEndDate);
  const anchorDate = useAppStore(s => s.sprintAnchorDate);
  const lengthDays = useAppStore(s => s.sprintLengthDays);

  return useMemo(() => {
    if (!enabled) return null;
    const sprints = computeSprintBoundaries(renderStartDate, renderEndDate, anchorDate, lengthDays);
    const result = computeCapacity({ members: [{ id: memberId }], blocks, sprints });
    return {
      sprints,
      figures: memberFigures(result, memberId),
      totalDays: daysBetween(renderStartDate, renderEndDate) + 1,
    };
  }, [enabled, blocks, renderStartDate, renderEndDate, anchorDate, lengthDays, memberId]);
}

/**
 * One member's load in the sprint that contains today — the figure the sidebar
 * shows. Computed from the same anchor and length as the bands, so it is the
 * band labelled "Current Sprint" even when that band is scrolled out of view.
 */
export function useMemberCurrentLoad(memberId: string): CapacityFigure | null {
  const enabled = useAppStore(s => s.capacityEnabled);
  const blocks = useAppStore(s => s.blocks);
  const anchorDate = useAppStore(s => s.sprintAnchorDate);
  const lengthDays = useAppStore(s => s.sprintLengthDays);

  return useMemo(() => {
    if (!enabled) return null;
    const today = isoToday();
    const [sprint] = computeSprintBoundaries(today, today, anchorDate, lengthDays);
    if (!sprint) return null;
    const result = computeCapacity({ members: [{ id: memberId }], blocks, sprints: [sprint] });
    return result.bySprintStart.get(sprint.startDate)?.byMemberId.get(memberId) ?? null;
  }, [enabled, blocks, anchorDate, lengthDays, memberId]);
}

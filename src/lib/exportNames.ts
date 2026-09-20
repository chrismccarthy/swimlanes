import { useAppStore } from '../store/useAppStore';

/**
 * Names for exported files.
 *
 * `DEFAULT_BOARD_NAME` is the label used when no board is current (it only
 * happens before the board list has loaded).
 */
export const DEFAULT_BOARD_NAME = 'Team';

/** The current board's name, for export file names and the print title. */
export function useBoardName(): string {
  return useAppStore(s => s.boards.find(b => b.id === s.currentBoardId)?.name ?? DEFAULT_BOARD_NAME);
}

/** Lower-case, dash-separated, safe in a file name on every platform. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    // Strip combining marks so "Ada Ünal" becomes "ada-unal", not "ada--nal".
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'board';
}

/** e.g. exportFileName('Team', '2026-09-17', 'png') -> "swimlanes-team-2026-09-17.png" */
export function exportFileName(boardName: string, isoDate: string, extension: string): string {
  return `swimlanes-${slugify(boardName)}-${isoDate}.${extension}`;
}

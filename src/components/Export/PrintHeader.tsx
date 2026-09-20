import { useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { useAppStore } from '../../store/useAppStore';
import { useBoardName } from '../../lib/exportNames';
import { installPrintScale } from '../../lib/printScale';

function longDate(iso: string): string {
  return format(parseISO(iso), 'd MMM yyyy');
}

/**
 * The one piece of chrome that exists *only* on paper: printed output has no
 * window title bar, so the sheet says which board it is and what dates it
 * covers. Hidden on screen and in the PNG export by `print.css`.
 */
export function PrintHeader() {
  const renderStartDate = useAppStore(s => s.renderStartDate);
  const renderEndDate = useAppStore(s => s.renderEndDate);
  const boardName = useBoardName();
  // Rendered outside `.app` on purpose: the board is scaled down to fit the
  // page, and the title must stay readable at full size.
  useEffect(() => installPrintScale(() => document.querySelector<HTMLElement>('.app')), []);

  return (
    <div className="print-title" data-testid="print-title">
      <strong>Swimlanes — {boardName}</strong>
      <span>
        {longDate(renderStartDate)} – {longDate(renderEndDate)}
      </span>
    </div>
  );
}

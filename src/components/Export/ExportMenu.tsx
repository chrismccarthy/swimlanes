import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { isoToday } from '../../lib/dates';
import { generateIcs } from '../../lib/ics';
import type { IcsEvent } from '../../lib/ics';
import { downloadFile, downloadText } from '../../lib/download';
import { captureBoardPng } from '../../lib/exportImage';
import { useBoardName, exportFileName, slugify } from '../../lib/exportNames';
import { createIcsFeedUrl } from '../../lib/supabase/icsTokens';
import type { Block, Member } from '../../types';
import styles from './ExportMenu.module.css';

const ICS_MIME = 'text/calendar';

/** Stable, globally unique ids so re-importing updates events instead of duplicating them. */
function uidFor(block: Block): string {
  return `${block.id}@swimlanes`;
}

function toEvent(block: Block, title: string): IcsEvent {
  return {
    uid: uidFor(block),
    title,
    start: block.startDate,
    end: block.endDate,
  };
}

export function ExportMenu() {
  const members = useAppStore(s => s.members);
  const boardName = useBoardName();
  const blocks = useAppStore(s => s.blocks);
  const userId = useAppStore(s => s.userId);
  const addToast = useAppStore(s => s.addToast);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => a.sortOrder - b.sortOrder),
    [members]
  );

  const blocksOf = useCallback(
    (memberId: string) =>
      blocks
        .filter(b => b.memberId === memberId)
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title)),
    [blocks]
  );

  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  // Dismiss on a click anywhere outside the menu (the trigger lives inside the
  // wrapper, so its own click still reaches the toggle handler).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Escape closes from anywhere, not just from a focused item.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  const menuItems = useCallback(
    () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
    []
  );

  // Opening a menu moves focus into it, as a menu button should.
  useEffect(() => {
    if (open) menuItems()[0]?.focus();
  }, [open, menuItems]);

  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const items = menuItems();
      if (items.length === 0) return;
      const current = items.indexOf(document.activeElement as HTMLElement);

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const next = (current + step + items.length) % items.length;
        items[next].focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        items[0].focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        items[items.length - 1].focus();
      } else if (e.key === 'Tab') {
        // Tabbing out of a menu closes it rather than trapping focus.
        setOpen(false);
      }
    },
    [menuItems]
  );

  const handlePng = useCallback(async () => {
    close();
    setBusy(true);
    try {
      // One frame so React has removed the menu before the board is serialised.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const root = document.querySelector<HTMLElement>('.app');
      if (!root) throw new Error('The board is not on screen');
      const blob = await captureBoardPng(root);
      downloadFile(exportFileName(boardName, isoToday(), 'png'), blob);
    } catch {
      addToast('Could not create the image', 'error');
    } finally {
      setBusy(false);
    }
  }, [addToast, boardName, close]);

  const handlePrint = useCallback(() => {
    close();
    // Printing is synchronous and blocking: let React drop the menu first, or
    // it would be on the page (and on the paper) while the dialog is open.
    setTimeout(() => window.print(), 0);
  }, [close]);

  const handleAllIcs = useCallback(() => {
    const events = sortedMembers.flatMap(member =>
      blocksOf(member.id).map(block => toEvent(block, `${member.name}: ${block.title}`))
    );
    downloadText(
      exportFileName(boardName, isoToday(), 'ics'),
      generateIcs({ calendarName: `Swimlanes — ${boardName}`, events }),
      ICS_MIME
    );
    close();
  }, [blocksOf, boardName, close, sortedMembers]);

  const handleMemberIcs = useCallback(
    (member: Member) => {
      downloadText(
        `${slugify(member.name)}.ics`,
        generateIcs({
          calendarName: `Swimlanes — ${member.name}`,
          events: blocksOf(member.id).map(block => toEvent(block, block.title)),
        }),
        ICS_MIME
      );
      close();
    },
    [blocksOf, close]
  );

  const handleFeed = useCallback(
    async (member: Member) => {
      close();
      let url: string;
      try {
        url = await createIcsFeedUrl(member.id, userId ?? '');
      } catch (error) {
        // The artifact build has no server to serve a feed and says so here.
        addToast(
          error instanceof Error ? error.message : 'Could not create a calendar feed URL',
          'error'
        );
        return;
      }
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        addToast('Could not copy the feed URL to the clipboard', 'error');
        return;
      }
      addToast(`Calendar feed URL for ${member.name} copied`, 'info');
    },
    [addToast, close, userId]
  );

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        type="button"
        ref={triggerRef}
        className={styles.trigger}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        title="Export this board"
        data-testid="export-button"
      >
        {busy ? 'Working…' : 'Export'}
      </button>

      {open && (
        <div
          ref={menuRef}
          className={styles.menu}
          role="menu"
          aria-label="Export"
          onKeyDown={handleMenuKeyDown}
          data-print="hide"
          data-testid="export-menu"
        >
          <button type="button" role="menuitem" className={styles.item} onClick={handlePng}>
            Download PNG
          </button>
          <button type="button" role="menuitem" className={styles.item} onClick={handlePrint}>
            Print / Save as PDF
          </button>
          <div className={styles.divider} role="none" />
          <button type="button" role="menuitem" className={styles.item} onClick={handleAllIcs}>
            Download calendar (.ics) for all members
          </button>

          {sortedMembers.length > 0 && (
            <>
              <div className={styles.sectionLabel} role="none">
                Calendar per member
              </div>
              {sortedMembers.map(member => (
                <div key={member.id} className={styles.memberRow} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className={`${styles.item} ${styles.memberItem}`}
                    onClick={() => handleMemberIcs(member)}
                    title={`Download ${member.name}'s calendar`}
                  >
                    <span className={styles.memberName}>{member.name}</span>
                    <span className={styles.hint} aria-hidden="true">
                      .ics
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.feedBtn}
                    onClick={() => void handleFeed(member)}
                    aria-label={`Copy calendar feed URL for ${member.name}`}
                    title={`Copy a subscribable calendar feed URL for ${member.name}`}
                  >
                    &#128279;
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Hand a Blob to the user as a file.
 *
 * In a normal browser this is a temporary object URL and a synthetic anchor
 * click — the only way to name a client-generated file. Inside the claude.ai
 * artifact viewer the page is sandboxed and an anchor download does nothing;
 * there the viewer's own `downloads` capability shows the person a save
 * prompt instead. That capability only accepts an allow-list of extensions
 * (images, text, json, csv, pdf, …), so a format it refuses, such as `.ics`,
 * reports `unsupported` and the caller explains.
 */
const REVOKE_DELAY_MS = 40;

export type SaveOutcome = 'saved' | 'declined' | 'unsupported' | 'failed';

interface ViewerDownloads {
  save(request: { filename: string; data: Blob }): Promise<{ status: string }>;
}

interface ClaudeRuntime {
  use(name: string): Promise<unknown>;
}

function viewerRuntime(): ClaudeRuntime | null {
  const claude = (window as unknown as { claude?: ClaudeRuntime }).claude;
  return claude && typeof claude.use === 'function' ? claude : null;
}

function anchorDownload(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

export async function downloadFile(name: string, blob: Blob): Promise<SaveOutcome> {
  const claude = viewerRuntime();
  if (!claude) {
    anchorDownload(name, blob);
    return 'saved';
  }
  let downloads: ViewerDownloads | null = null;
  try {
    downloads = (await claude.use('downloads')) as ViewerDownloads | null;
  } catch {
    downloads = null;
  }
  if (!downloads) {
    // The runtime is present but cannot save here (e.g. served top-level).
    anchorDownload(name, blob);
    return 'saved';
  }
  try {
    await downloads.save({ filename: name, data: blob });
    return 'saved';
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === 'declined') return 'declined';
    if (code === 'rejected_extension' || code === 'extension_not_enabled') return 'unsupported';
    return 'failed';
  }
}

/** Convenience wrapper for the text formats we export (.ics). */
export function downloadText(name: string, text: string, mimeType: string): Promise<SaveOutcome> {
  return downloadFile(name, new Blob([text], { type: `${mimeType};charset=utf-8` }));
}

/** A short explanation for outcomes the person should hear about; null when nothing to say. */
export function saveOutcomeMessage(outcome: SaveOutcome, what: string): string | null {
  switch (outcome) {
    case 'unsupported':
      return `This viewer cannot save ${what}. Open the hosted version to download it.`;
    case 'failed':
      return `Could not save ${what}.`;
    default:
      return null;
  }
}

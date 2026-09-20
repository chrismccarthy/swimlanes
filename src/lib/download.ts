/**
 * Hand a Blob to the browser as a file download.
 *
 * Uses a temporary object URL and a synthetic anchor click — the only way to
 * name a client-generated file. The URL is revoked on a short delay because
 * revoking it in the same tick can cancel the download in some browsers.
 */
const REVOKE_DELAY_MS = 40;

export function downloadFile(name: string, blob: Blob): void {
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

/** Convenience wrapper for the text formats we export (.ics). */
export function downloadText(name: string, text: string, mimeType: string): void {
  downloadFile(name, new Blob([text], { type: `${mimeType};charset=utf-8` }));
}

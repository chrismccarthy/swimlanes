/**
 * Lightweight, dependency-free error reporting.
 *
 * - `initErrorReporting()` wires up global `window.onerror` /
 *   `unhandledrejection` handlers (call once, from `main.tsx`).
 * - `reportError(error, context?)` logs to the console and, when
 *   `VITE_ERROR_REPORT_URL` is configured, best-effort POSTs a JSON payload
 *   describing the error (nothing else — no breadcrumbs, no user data).
 * - `addBreadcrumb(message, data?)` keeps a small ring buffer of recent app
 *   actions, surfaced only in `getDiagnostics()` for the error boundary's
 *   "Copy diagnostics" button (a local, user-triggered clipboard copy).
 * - `getDiagnostics()` builds that full diagnostics blob.
 *
 * Every exported function is safe to call from anywhere, including inside
 * error handlers themselves: nothing in this module throws.
 */

export interface Breadcrumb {
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

export interface Diagnostics {
  message: string;
  stack?: string;
  componentStack?: string;
  appVersion: string;
  userAgent: string;
  url: string;
  timestamp: string;
  breadcrumbs: Breadcrumb[];
}

const MAX_BREADCRUMBS = 20;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const DEDUPE_WINDOW_MS = 5_000;

let breadcrumbs: Breadcrumb[] = [];
let sendTimestamps: number[] = [];
let lastKey: string | null = null;
let lastKeyTime = 0;
let handlersRegistered = false;

function appVersion(): string {
  return import.meta.env.VITE_APP_VERSION || 'dev';
}

function safeUserAgent(): string {
  return typeof navigator !== 'undefined' ? navigator.userAgent : '';
}

function safeUrl(): string {
  return typeof location !== 'undefined' ? location.href : '';
}

export function addBreadcrumb(message: string, data?: Record<string, unknown>): void {
  try {
    breadcrumbs.push({ message, data, timestamp: new Date().toISOString() });
    if (breadcrumbs.length > MAX_BREADCRUMBS) {
      breadcrumbs = breadcrumbs.slice(breadcrumbs.length - MAX_BREADCRUMBS);
    }
  } catch {
    // never throw
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

/** Full diagnostics blob for the error boundary's "Copy diagnostics" action. */
export function getDiagnostics(error?: unknown, componentStack?: string): Diagnostics {
  return {
    message: error !== undefined ? errorMessage(error) : '',
    stack: errorStack(error),
    componentStack,
    appVersion: appVersion(),
    userAgent: safeUserAgent(),
    url: safeUrl(),
    timestamp: new Date().toISOString(),
    breadcrumbs: [...breadcrumbs],
  };
}

function sendReport(url: string, payload: unknown): void {
  let json: string;
  try {
    json = JSON.stringify(payload);
  } catch {
    return;
  }
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([json], { type: 'application/json' });
      if (navigator.sendBeacon(url, blob)) return;
    }
  } catch {
    // fall through to fetch
  }
  try {
    if (typeof fetch === 'function') {
      void fetch(url, {
        method: 'POST',
        body: json,
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // never throw
  }
}

/**
 * Logs the error and, when configured, reports it. The console log always
 * happens; the network report is rate-limited (10/min) and deduped
 * (identical message+stack within 5s) so a render loop can't flood anything.
 * The reported payload is limited to the error itself plus `context` — no
 * breadcrumbs, no other app state.
 */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  try {
    console.error('Reported error:', error, context);

    const url = import.meta.env.VITE_ERROR_REPORT_URL;
    if (!url) return;

    const message = errorMessage(error);
    const stack = errorStack(error);
    const key = `${message}\n${stack ?? ''}`;
    const now = Date.now();

    if (key === lastKey && now - lastKeyTime < DEDUPE_WINDOW_MS) return;

    sendTimestamps = sendTimestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (sendTimestamps.length >= RATE_LIMIT_MAX) return;
    sendTimestamps.push(now);
    lastKey = key;
    lastKeyTime = now;

    sendReport(url, {
      message,
      stack,
      context,
      appVersion: appVersion(),
      userAgent: safeUserAgent(),
      url: safeUrl(),
      timestamp: new Date().toISOString(),
    });
  } catch {
    // never throw
  }
}

/** Registers global handlers for uncaught errors and rejections. Idempotent. */
export function initErrorReporting(): void {
  if (handlersRegistered) return;
  if (typeof window === 'undefined') return;
  handlersRegistered = true;

  window.onerror = (message, source, lineno, colno, error) => {
    reportError(error ?? message, { source, lineno, colno });
  };

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    reportError(event.reason, { type: 'unhandledrejection' });
  });
}

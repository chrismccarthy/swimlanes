import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The reporter keeps module-level state (breadcrumb ring buffer, rate-limit
 * and dedupe windows), so each test resets modules and re-imports it fresh.
 */
async function loadReporter() {
  vi.resetModules();
  return import('./errorReporter');
}

const originalSendBeacon = navigator.sendBeacon;
const originalFetch = globalThis.fetch;

/** A typed `navigator.sendBeacon` mock whose `.mock.calls` are indexable. */
function beaconMock(result: boolean) {
  return vi.fn<(url: string, data?: BodyInit | null) => boolean>(() => result);
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  Object.defineProperty(navigator, 'sendBeacon', { value: originalSendBeacon, configurable: true, writable: true });
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('addBreadcrumb / getDiagnostics', () => {
  it('keeps only the last 20 breadcrumbs (ring buffer)', async () => {
    const { addBreadcrumb, getDiagnostics } = await loadReporter();

    for (let i = 0; i < 25; i++) {
      addBreadcrumb(`action-${i}`);
    }

    const { breadcrumbs } = getDiagnostics();
    expect(breadcrumbs).toHaveLength(20);
    expect(breadcrumbs[0].message).toBe('action-5');
    expect(breadcrumbs[19].message).toBe('action-24');
  });

  it('carries the data payload and a timestamp', async () => {
    const { addBreadcrumb, getDiagnostics } = await loadReporter();
    addBreadcrumb('add block', { color: 'blue' });

    const { breadcrumbs } = getDiagnostics();
    expect(breadcrumbs).toHaveLength(1);
    expect(breadcrumbs[0]).toMatchObject({ message: 'add block', data: { color: 'blue' } });
    expect(typeof breadcrumbs[0].timestamp).toBe('string');
  });

  it('getDiagnostics reports message, stack, component stack and app version', async () => {
    const { getDiagnostics } = await loadReporter();
    const error = new Error('boom');

    const diagnostics = getDiagnostics(error, 'in <Timeline>');

    expect(diagnostics.message).toBe('boom');
    expect(diagnostics.stack).toBe(error.stack);
    expect(diagnostics.componentStack).toBe('in <Timeline>');
    expect(diagnostics.appVersion).toBe('dev'); // no VITE_APP_VERSION set in tests
    expect(typeof diagnostics.userAgent).toBe('string');
    expect(typeof diagnostics.url).toBe('string');
    expect(typeof diagnostics.timestamp).toBe('string');
  });
});

describe('reportError', () => {
  it('always logs to the console, even with no report URL configured', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { reportError } = await loadReporter();

    reportError(new Error('no url configured'));

    expect(consoleSpy).toHaveBeenCalled();
  });

  it('never throws, even for a non-Error value and a circular context', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { reportError } = await loadReporter();

    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => reportError('just a string', { circular })).not.toThrow();
  });

  it('does not send a report when VITE_ERROR_REPORT_URL is unset', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const beacon = beaconMock(true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true, writable: true });
    const { reportError } = await loadReporter();

    reportError(new Error('nowhere to go'));

    expect(beacon).not.toHaveBeenCalled();
  });

  it('uses navigator.sendBeacon when available', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('VITE_ERROR_REPORT_URL', 'https://reports.example.test/errors');
    const beacon = beaconMock(true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true, writable: true });
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { reportError } = await loadReporter();

    reportError(new Error('beacon path'));

    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0][0]).toBe('https://reports.example.test/errors');
    expect(beacon.mock.calls[0][1]).toBeInstanceOf(Blob);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to fetch with keepalive when sendBeacon is unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('VITE_ERROR_REPORT_URL', 'https://reports.example.test/errors');
    Object.defineProperty(navigator, 'sendBeacon', { value: undefined, configurable: true, writable: true });
    const fetchSpy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(new Response()));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { reportError } = await loadReporter();

    reportError(new Error('fetch path'));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://reports.example.test/errors');
    expect(init).toMatchObject({ method: 'POST', keepalive: true });
    expect(JSON.parse(init?.body as string).message).toBe('fetch path');
  });

  it('falls back to fetch when sendBeacon returns false (queue full)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('VITE_ERROR_REPORT_URL', 'https://reports.example.test/errors');
    const beacon = beaconMock(false);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true, writable: true });
    const fetchSpy = vi.fn().mockResolvedValue(undefined);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { reportError } = await loadReporter();

    reportError(new Error('beacon rejected'));

    expect(beacon).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not include breadcrumbs or unrelated app state in the reported payload', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('VITE_ERROR_REPORT_URL', 'https://reports.example.test/errors');
    const beacon = beaconMock(true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true, writable: true });
    const { reportError, addBreadcrumb } = await loadReporter();

    addBreadcrumb('add member');
    reportError(new Error('scoped payload'), { where: 'test' });

    const blob = beacon.mock.calls[0][1] as Blob;
    const text = await blob.text();
    const payload = JSON.parse(text);
    expect(payload).not.toHaveProperty('breadcrumbs');
    expect(Object.keys(payload).sort()).toEqual(
      ['appVersion', 'context', 'message', 'stack', 'timestamp', 'url', 'userAgent'].sort(),
    );
  });

  it('dedupes an identical message+stack reported again within 5s', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('VITE_ERROR_REPORT_URL', 'https://reports.example.test/errors');
    const beacon = beaconMock(true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true, writable: true });
    const { reportError } = await loadReporter();

    const error = new Error('duplicate boom');
    reportError(error);
    reportError(error);
    reportError(error);

    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it('sends again once the dedupe window has passed', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.stubEnv('VITE_ERROR_REPORT_URL', 'https://reports.example.test/errors');
      const beacon = beaconMock(true);
      Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true, writable: true });
      const { reportError } = await loadReporter();

      const error = new Error('repeats after cooldown');
      reportError(error);
      vi.advanceTimersByTime(5_001);
      reportError(error);

      expect(beacon).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rate-limits to at most 10 reports per minute', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('VITE_ERROR_REPORT_URL', 'https://reports.example.test/errors');
    const beacon = beaconMock(true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true, writable: true });
    const { reportError } = await loadReporter();

    // Distinct messages so dedupe never kicks in — only the rate limit should.
    for (let i = 0; i < 15; i++) {
      reportError(new Error(`error-${i}`));
    }

    expect(beacon).toHaveBeenCalledTimes(10);
  });

  it('allows more reports once the rate-limit window has passed', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.stubEnv('VITE_ERROR_REPORT_URL', 'https://reports.example.test/errors');
      const beacon = beaconMock(true);
      Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true, writable: true });
      const { reportError } = await loadReporter();

      for (let i = 0; i < 10; i++) {
        reportError(new Error(`first-batch-${i}`));
      }
      expect(beacon).toHaveBeenCalledTimes(10);

      // Still within the window: the 11th distinct error is dropped.
      reportError(new Error('still-limited'));
      expect(beacon).toHaveBeenCalledTimes(10);

      vi.advanceTimersByTime(60_001);
      reportError(new Error('after-window'));
      expect(beacon).toHaveBeenCalledTimes(11);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('initErrorReporting', () => {
  it('registers window.onerror and unhandledrejection exactly once even when called twice', async () => {
    const { initErrorReporting } = await loadReporter();
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

    initErrorReporting();
    const firstHandler = window.onerror;
    initErrorReporting();

    expect(window.onerror).toBe(firstHandler);
    expect(addEventListenerSpy.mock.calls.filter(([type]) => type === 'unhandledrejection')).toHaveLength(1);
  });

  it('routes a window.onerror callback through reportError (logs to console)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { initErrorReporting } = await loadReporter();

    initErrorReporting();
    window.onerror?.('boom message', 'app.js', 1, 1, new Error('boom message'));

    expect(consoleSpy).toHaveBeenCalled();
  });
});

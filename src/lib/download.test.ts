import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { downloadFile, downloadText } from './download';

describe('downloadFile', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let clicked: HTMLAnchorElement[];

  beforeEach(() => {
    vi.useFakeTimers();
    clicked = [];
    createObjectURL = vi.fn(() => 'blob:mock-url');
    revokeObjectURL = vi.fn();
    // jsdom implements neither of these.
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('clicks an anchor carrying the file name and an object URL for the blob', () => {
    const blob = new Blob(['hello'], { type: 'text/plain' });
    downloadFile('report.txt', blob);

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('report.txt');
    expect(clicked[0].getAttribute('href')).toBe('blob:mock-url');
  });

  it('leaves no anchor behind in the document', () => {
    downloadFile('a.txt', new Blob(['a']));
    expect(document.querySelectorAll('a')).toHaveLength(0);
  });

  it('revokes the object URL, but only after the click has been handled', () => {
    downloadFile('a.txt', new Blob(['a']));
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});

describe('downloadText', () => {
  it('wraps the text in a blob of the given type', async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:mock-url');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadText('team.ics', 'BEGIN:VCALENDAR\r\n', 'text/calendar');

    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe('text/calendar;charset=utf-8');
    expect(await blob.text()).toBe('BEGIN:VCALENDAR\r\n');
    vi.unstubAllGlobals();
  });
});

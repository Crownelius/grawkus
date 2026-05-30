import { describe, expect, it } from 'vitest';
import { shouldUseLiveQueue } from '../src/live-queue.js';

describe('live queue terminal safety', () => {
  it('disables the scroll-region queue by default on Windows terminals', () => {
    expect(shouldUseLiveQueue('win32', {})).toBe(false);
  });

  it('allows explicit opt-in and opt-out through GRAWKUS_LIVE_QUEUE', () => {
    expect(shouldUseLiveQueue('win32', { GRAWKUS_LIVE_QUEUE: '1' })).toBe(true);
    expect(shouldUseLiveQueue('linux', { GRAWKUS_LIVE_QUEUE: '0' })).toBe(false);
  });

  it('keeps the live queue enabled by default on non-Windows terminals', () => {
    expect(shouldUseLiveQueue('linux', {})).toBe(true);
    expect(shouldUseLiveQueue('darwin', {})).toBe(true);
  });
});

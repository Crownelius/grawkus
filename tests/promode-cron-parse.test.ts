import { describe, expect, it } from 'vitest';
import { parseSchedule, getNextRunAt } from '../src/promode/cron-parse.js';

describe('ProMode cron parse', () => {
  it('parses interval schedules', () => {
    const p = parseSchedule('5m');
    expect(p.kind).toBe('interval');
    if (p.kind === 'interval') expect(p.ms).toBe(5 * 60 * 1000);
  });

  it('computes next interval run from lastRunAt', () => {
    const base = new Date('2026-05-30T10:00:00.000Z');
    const last = '2026-05-30T10:00:00.000Z';
    const next = getNextRunAt('30s', last, base);
    expect(next?.toISOString()).toBe('2026-05-30T10:00:30.000Z');
  });

  it('matches 5-field cron at minute boundary', () => {
    const at = new Date('2026-05-30T09:00:00.000Z');
    const next = getNextRunAt('0 9 * * *', undefined, at);
    expect(next).not.toBeNull();
    expect(next!.getUTCHours()).toBe(9);
    expect(next!.getUTCMinutes()).toBe(0);
  });
});

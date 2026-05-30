/**
 * Zero-dep schedule parsing: intervals (30s, 5m, 2h, 1d) and minimal 5-field cron.
 */

export type ParsedSchedule =
  | { kind: 'interval'; ms: number; raw: string }
  | { kind: 'cron'; fields: [string, string, string, string, string]; raw: string };

const INTERVAL_RE = /^(\d+(?:\.\d+)?)(s|m|h|d)$/i;

export function parseSchedule(raw: string): ParsedSchedule {
  const trimmed = raw.trim();
  const m = INTERVAL_RE.exec(trimmed);
  if (m) {
    const n = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    return { kind: 'interval', ms: n * mult, raw: trimmed };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid schedule "${raw}": use interval (30s, 5m, 2h, 1d) or 5-field cron (min hour dom month dow)`);
  }
  return {
    kind: 'cron',
    fields: parts as [string, string, string, string, string],
    raw: trimmed,
  };
}

function matchField(field: string, value: number, max: number): boolean {
  if (field === '*') return true;
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    return !Number.isNaN(step) && step > 0 && value % step === 0;
  }
  if (field.includes(',')) {
    return field.split(',').some((p) => matchField(p.trim(), value, max));
  }
  if (field.includes('-')) {
    const [a, b] = field.split('-').map((x) => parseInt(x, 10));
    return value >= a && value <= b;
  }
  const n = parseInt(field, 10);
  return !Number.isNaN(n) && n === value;
}

function cronMatches(date: Date, fields: [string, string, string, string, string]): boolean {
  const [min, hour, dom, month, dow] = fields;
  return (
    matchField(min, date.getUTCMinutes(), 59) &&
    matchField(hour, date.getUTCHours(), 23) &&
    matchField(dom, date.getUTCDate(), 31) &&
    matchField(month, date.getUTCMonth() + 1, 12) &&
    matchField(dow, date.getUTCDay(), 6)
  );
}

export function getNextRunAt(
  scheduleRaw: string,
  lastRunAt: string | undefined,
  from: Date = new Date(),
): Date | null {
  const parsed = parseSchedule(scheduleRaw);
  if (parsed.kind === 'interval') {
    const base = lastRunAt ? new Date(lastRunAt) : from;
    const nextMs = base.getTime() + parsed.ms;
    if (nextMs <= from.getTime()) {
      const elapsed = from.getTime() - base.getTime();
      const steps = Math.floor(elapsed / parsed.ms) + 1;
      return new Date(base.getTime() + steps * parsed.ms);
    }
    return new Date(nextMs);
  }

  const cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (cronMatches(cursor, parsed.fields)) {
      if (cursor.getTime() > from.getTime()) return new Date(cursor);
      if (!lastRunAt && cursor.getTime() === from.getTime()) return new Date(cursor);
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return null;
}

export function isScheduleDue(
  scheduleRaw: string,
  lastRunAt: string | undefined,
  now: Date = new Date(),
): boolean {
  const next = getNextRunAt(scheduleRaw, lastRunAt, new Date(now.getTime() - 60_000));
  if (!next) return false;
  const dueAt = getNextRunAt(scheduleRaw, lastRunAt, now);
  return dueAt !== null && dueAt.getTime() <= now.getTime();
}

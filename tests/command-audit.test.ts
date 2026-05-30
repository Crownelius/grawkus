import { describe, expect, it } from 'vitest';
import {
  buildCommandAuditReport,
  formatCommandAuditReport,
  parseCommandAuditArgs,
} from '../src/command-audit.js';

describe('command audit', () => {
  it('parses json and strict flags', () => {
    expect(parseCommandAuditArgs('--json --strict')).toEqual({ json: true, strict: true });
    expect(parseCommandAuditArgs('--format json')).toEqual({ json: true, strict: false });
    expect(parseCommandAuditArgs('')).toEqual({ json: false, strict: false });
  });

  it('audits the command surface without hard failures', () => {
    const report = buildCommandAuditReport({}, new Date('2026-05-30T00:00:00.000Z'));

    expect(report.format).toBe('grawkus-command-audit-v1');
    expect(report.status).not.toBe('fail');
    expect(report.summary.catalogCommands).toBeGreaterThan(50);
    expect(report.summary.completionNames).toBeGreaterThan(report.summary.catalogCommands);
    expect(report.summary.failures).toBe(0);
    expect(report.issues.filter((issue) => issue.severity === 'fail')).toEqual([]);
  });

  it('formats text and json output', () => {
    const report = buildCommandAuditReport({}, new Date('2026-05-30T00:00:00.000Z'));

    expect(formatCommandAuditReport(report)).toContain('Grawkus Command Audit');

    const parsed = JSON.parse(formatCommandAuditReport(report, { json: true })) as { format: string };
    expect(parsed.format).toBe('grawkus-command-audit-v1');
  });
});

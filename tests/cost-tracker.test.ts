import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _internal,
  getUsageSummary,
  printUsageSummary,
  trackUsage,
} from '../src/cost-tracker.js';

describe('cost tracker', () => {
  const originalHome = process.env.GRAWKUS_HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'grawkus-usage-'));
    process.env.GRAWKUS_HOME = home;
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.GRAWKUS_HOME;
    } else {
      process.env.GRAWKUS_HOME = originalHome;
    }
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('tracks per-session totals, provider metadata, and latency', () => {
    trackUsage('session-a', 'openrouter/free', 100, 50, {
      provider: 'OpenRouter (Any Model)',
      firstTokenMs: 1200,
      durationMs: 4800,
    });
    trackUsage('session-b', 'openrouter/free', 10, 5, {
      provider: 'OpenRouter (Any Model)',
      firstTokenMs: 50,
      durationMs: 80,
    });
    trackUsage('session-a', 'openrouter/free', 200, 150, {
      provider: 'OpenRouter (Any Model)',
      firstTokenMs: 300,
      durationMs: 600,
    });

    const summary = getUsageSummary('session-a');

    expect(summary.session.calls).toBe(2);
    expect(summary.session.tokens).toBe(500);
    expect(summary.session.promptTokens).toBe(300);
    expect(summary.session.completionTokens).toBe(200);
    expect(summary.session.averageFirstTokenMs).toBe(750);
    expect(summary.session.averageDurationMs).toBe(2700);
    expect(summary.today.calls).toBe(3);
    expect(summary.allTime.tokens).toBe(515);
    expect(summary.last?.sessionId).toBe('session-a');
    expect(summary.last?.provider).toBe('OpenRouter (Any Model)');

    const persisted = JSON.parse(readFileSync(_internal.getUsageFile(), 'utf-8'));
    expect(persisted.entries.at(-1)).toMatchObject({
      sessionId: 'session-a',
      provider: 'OpenRouter (Any Model)',
      firstTokenMs: 300,
      durationMs: 600,
    });
  });

  it('prints a session-aware usage summary', () => {
    trackUsage('session-a', 'openrouter/free', 100, 50, {
      provider: 'OpenRouter',
      firstTokenMs: 250,
      durationMs: 900,
    });
    trackUsage('session-b', 'openrouter/free', 900, 50);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    printUsageSummary('session-a');

    const output = log.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('Session:');
    expect(output).toContain('150 tokens');
    expect(output).toContain('avg first 250ms');
    expect(output).toContain('OpenRouter | openrouter/free');
  });
});

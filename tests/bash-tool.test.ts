import { afterEach, describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BashTool,
  DEFAULT_BASH_TIMEOUT_MS,
  MAX_BASH_TIMEOUT_MS,
  resolveBashTimeoutMs,
  truncateBashOutput,
} from '../src/tools/bash.js';

const ORIGINAL_MAX_CHARS = process.env.GRAWKUS_BASH_MAX_OUTPUT_CHARS;
const ORIGINAL_MAX_LINES = process.env.GRAWKUS_BASH_MAX_OUTPUT_LINES;

afterEach(() => {
  if (ORIGINAL_MAX_CHARS === undefined) {
    delete process.env.GRAWKUS_BASH_MAX_OUTPUT_CHARS;
  } else {
    process.env.GRAWKUS_BASH_MAX_OUTPUT_CHARS = ORIGINAL_MAX_CHARS;
  }
  if (ORIGINAL_MAX_LINES === undefined) {
    delete process.env.GRAWKUS_BASH_MAX_OUTPUT_LINES;
  } else {
    process.env.GRAWKUS_BASH_MAX_OUTPUT_LINES = ORIGINAL_MAX_LINES;
  }
});

function extractFullLog(output: string): string {
  const match = output.match(/fullLog=(.+?)\]$/s);
  expect(match).not.toBeNull();
  return match![1];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('truncateBashOutput', () => {
  it('returns small output unchanged', () => {
    const result = truncateBashOutput('alpha\nbeta', 1000, 100);
    expect(result.truncated).toBe(false);
    expect(result.output).toBe('alpha\nbeta');
  });

  it('returns a bounded tail when line count is too large', () => {
    const raw = Array.from({ length: 50 }, (_, i) => `line-${i}`).join('\n');
    const result = truncateBashOutput(raw, 10_000, 5);

    expect(result.truncated).toBe(true);
    expect(result.omittedLines).toBeGreaterThan(0);
    expect(result.output).toContain('output truncated');
    expect(result.output).toContain('line-49');
    expect(result.output).not.toContain('line-0\n');
  });

  it('returns a bounded tail when character count is too large', () => {
    const raw = `prefix\n${'x'.repeat(2000)}\nsuffix`;
    const result = truncateBashOutput(raw, 200, 100);

    expect(result.truncated).toBe(true);
    expect(result.output.length).toBeLessThan(500);
    expect(result.output).toContain('suffix');
    expect(result.output).not.toContain('prefix');
  });

  it('normalizes empty output', () => {
    const result = truncateBashOutput('', 200, 10);
    expect(result.truncated).toBe(false);
    expect(result.output).toBe('(no output)');
  });
});

describe('BashTool output logs', () => {
  it('saves full output when foreground command output is truncated', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-bash-'));
    process.env.GRAWKUS_BASH_MAX_OUTPUT_CHARS = '80';
    process.env.GRAWKUS_BASH_MAX_OUTPUT_LINES = '100';
    try {
      const result = await BashTool.call({
        command: 'node -e "process.stdout.write(\'HEAD\' + \'x\'.repeat(1000) + \'TAIL\')"',
      }, cwd);

      expect(result.isError).toBe(false);
      expect(result.output).toContain('output truncated');
      expect(result.output).toContain('fullLog=');
      const logPath = extractFullLog(result.output);
      expect(existsSync(logPath)).toBe(true);
      const log = readFileSync(logPath, 'utf-8');
      expect(log).toContain('HEAD');
      expect(log).toContain('TAIL');
      expect(log).toContain('truncated: true');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('saves partial output and structured status when a foreground command times out', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-bash-'));
    try {
      const result = await BashTool.call({
        command: 'node -e "process.stdout.write(\'started\'); setTimeout(() => {}, 200)"',
        timeoutMs: 50,
      }, cwd);

      expect(result.isError).toBe(true);
      expect(result.output).toContain('command timed out after 50ms');
      expect(result.output).toContain('timedOut=true');
      const logPath = extractFullLog(result.output);
      expect(existsSync(logPath)).toBe(true);
      const log = readFileSync(logPath, 'utf-8');
      expect(log).toContain('timedOut: true');
      expect(log).toContain('started');
    } finally {
      await sleep(350);
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('resolveBashTimeoutMs', () => {
  it('uses the default timeout when no override is provided', () => {
    expect(resolveBashTimeoutMs({}, {}).timeoutMs).toBe(DEFAULT_BASH_TIMEOUT_MS);
  });

  it('uses GRAWKUS_BASH_TIMEOUT_MS as the default when set', () => {
    expect(resolveBashTimeoutMs({}, { GRAWKUS_BASH_TIMEOUT_MS: '300000' }).timeoutMs).toBe(300_000);
  });

  it('prefers timeoutMs over the legacy timeout alias', () => {
    expect(resolveBashTimeoutMs({ timeout: 10_000, timeoutMs: 20_000 }, {}).timeoutMs).toBe(20_000);
  });

  it('supports timeoutSec as a Goose-compatible seconds alias', () => {
    expect(resolveBashTimeoutMs({ timeoutSec: 45 }, {}).timeoutMs).toBe(45_000);
  });

  it('prefers timeoutMs over timeoutSec when both are provided', () => {
    expect(resolveBashTimeoutMs({ timeoutMs: 20_000, timeoutSec: 45 }, {}).timeoutMs).toBe(20_000);
  });

  it('keeps the legacy timeout alias working', () => {
    expect(resolveBashTimeoutMs({ timeout: '45000' }, {}).timeoutMs).toBe(45_000);
  });

  it('caps runaway timeouts at the 30 minute maximum', () => {
    const result = resolveBashTimeoutMs({ timeoutMs: MAX_BASH_TIMEOUT_MS + 1 }, {});
    expect(result.timeoutMs).toBe(MAX_BASH_TIMEOUT_MS);
    expect(result.capped).toBe(true);
  });
});

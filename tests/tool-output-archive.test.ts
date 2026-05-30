import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveLargeToolOutput } from '../src/tool-output-archive.js';

const ORIGINAL_TRIGGER = process.env.GRAWKUS_TOOL_OUTPUT_ARCHIVE_CHARS;

afterEach(() => {
  if (ORIGINAL_TRIGGER === undefined) {
    delete process.env.GRAWKUS_TOOL_OUTPUT_ARCHIVE_CHARS;
  } else {
    process.env.GRAWKUS_TOOL_OUTPUT_ARCHIVE_CHARS = ORIGINAL_TRIGGER;
  }
});

function extractSavedPath(output: string): string {
  const match = output.match(/full tool output saved to (.+?);/);
  expect(match).not.toBeNull();
  return match![1];
}

describe('archiveLargeToolOutput', () => {
  it('leaves small outputs unchanged', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-tool-output-'));
    try {
      const result = archiveLargeToolOutput(cwd, 'grep', 'small output');
      expect(result).toEqual({ output: 'small output', archived: false });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('saves large outputs and returns a compact log reference', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-tool-output-'));
    process.env.GRAWKUS_TOOL_OUTPUT_ARCHIVE_CHARS = '80';
    try {
      const raw = `HEAD\n${'x'.repeat(500)}\nTAIL`;
      const result = archiveLargeToolOutput(cwd, 'grep', raw);
      expect(result.archived).toBe(true);
      expect(result.output).toContain('tool output truncated');
      expect(result.output).toContain('full tool output saved to');
      expect(result.output).toContain('HEAD');
      expect(result.output).toContain('TAIL');

      const savedPath = result.logPath ?? extractSavedPath(result.output);
      expect(existsSync(savedPath)).toBe(true);
      const saved = readFileSync(savedPath, 'utf-8');
      expect(saved).toContain('tool: grep');
      expect(saved).toContain(raw);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

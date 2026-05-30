import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRuntimeInfoBlock } from '../src/runtime-info.js';

describe('buildRuntimeInfoBlock', () => {
  it('renders cwd, time, and non-git state', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-runtime-'));
    try {
      const block = buildRuntimeInfoBlock(cwd, new Date('2026-05-26T12:00:00.000Z'));
      expect(block).toContain('<runtime_info>');
      expect(block).toContain(cwd.replace(/\\/g, '/'));
      expect(block).toContain('2026-05-26T12:00:00.000Z');
      expect(block).toContain('git: not a git repo');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('summarizes dirty git status when available', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-runtime-'));
    try {
      execFileSync('git', ['init'], { cwd, stdio: 'ignore' });
      writeFileSync(join(cwd, 'a.txt'), 'hello\n');
      const block = buildRuntimeInfoBlock(cwd, new Date('2026-05-26T12:00:00.000Z'));
      expect(block).toContain('git: 1 changed');
      expect(block).toContain('a.txt');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

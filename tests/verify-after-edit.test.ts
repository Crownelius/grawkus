import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildEditVerificationReminder,
  editedTargetsFromToolCall,
  isVerificationToolCall,
  recordFileEditStates,
  snapshotFileEditStates,
} from '../src/query.js';

describe('edit verification helpers', () => {
  it('extracts changed targets from write/edit tool calls', () => {
    expect(editedTargetsFromToolCall('write_file', '{"file_path":"src/a.ts","content":"x"}'))
      .toEqual(['src/a.ts']);
    expect(editedTargetsFromToolCall('edit_file', '{"file_path":"src/b.ts","old_string":"a","new_string":"b"}'))
      .toEqual(['src/b.ts']);
    expect(editedTargetsFromToolCall('bash', '{"command":"echo hi"}')).toEqual([]);
  });

  it('extracts changed targets from apply_patch envelopes', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/a.ts',
      '@@',
      '-old',
      '+new',
      '*** Add File: src/b.ts',
      '+new file',
      '*** Delete File: src/old.ts',
      '*** End Patch',
    ].join('\n');

    expect(editedTargetsFromToolCall('apply_patch', JSON.stringify({ patch })))
      .toEqual(['src/a.ts', 'src/b.ts', 'src/old.ts']);
  });

  it('recognizes common verification commands', () => {
    expect(isVerificationToolCall('bash', '{"command":"npm test -- --runInBand"}')).toBe(true);
    expect(isVerificationToolCall('bash', '{"command":"pnpm build"}')).toBe(true);
    expect(isVerificationToolCall('bash', '{"command":"cargo check"}')).toBe(true);
    expect(isVerificationToolCall('bash', '{"command":"ls src"}')).toBe(false);
    expect(isVerificationToolCall('grep', '{"pattern":"test"}')).toBe(false);
  });

  it('builds a concise verification reminder for pending edits', () => {
    const out = buildEditVerificationReminder(['src/a.ts', 'src/b.ts'], 2);
    expect(out).toContain('Verification needed');
    expect(out).toContain('2 successful edits');
    expect(out).toContain('src/a.ts, src/b.ts');
    expect(out).toContain('narrowest useful verification command');
  });

  it('returns null when no edits are pending', () => {
    expect(buildEditVerificationReminder([], 0)).toBeNull();
  });

  it('detects successful edit calls that leave file content unchanged', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-edit-'));
    try {
      mkdirSync(join(cwd, 'src'));
      writeFileSync(join(cwd, 'src', 'a.ts'), 'export const x = 1;\n');
      const before = snapshotFileEditStates(cwd, ['src/a.ts']);

      writeFileSync(join(cwd, 'src', 'a.ts'), 'export const x = 1;\n');
      const reminders = recordFileEditStates(cwd, ['src/a.ts'], new Map(), before);

      expect(reminders).toHaveLength(1);
      expect(reminders[0]).toContain('content hash is unchanged from before the edit');
      expect(reminders[0]).toContain('src/a.ts');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('detects repeated file states even when edit arguments drift', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-edit-'));
    try {
      writeFileSync(join(cwd, 'a.ts'), 'export const x = 1;\n');
      const lastStates = new Map();

      expect(recordFileEditStates(cwd, ['a.ts'], lastStates)).toEqual([]);
      const reminders = recordFileEditStates(cwd, ['./a.ts'], lastStates);

      expect(reminders).toHaveLength(1);
      expect(reminders[0]).toContain('matches a previous successful edit');
      expect(reminders[0]).toContain('./a.ts');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('does not warn when a successful edit changes file content', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-edit-'));
    try {
      writeFileSync(join(cwd, 'a.ts'), 'before\n');
      const before = snapshotFileEditStates(cwd, ['a.ts']);
      const lastStates = new Map();

      writeFileSync(join(cwd, 'a.ts'), 'after\n');
      expect(recordFileEditStates(cwd, ['a.ts'], lastStates, before)).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

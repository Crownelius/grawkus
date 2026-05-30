/**
 * Coverage for bin/ecc-hooks.cjs gateguard check.
 *
 * The hook is security-critical — bugs here let a model bypass the
 * "investigate before editing" gate. v1.27.1 added a yolo bypass +
 * env-var disable knob; v1.27.2 added a "skip non-existent files"
 * branch; v1.28.1 added sessionId sanitization to plug a path-
 * traversal. These tests pin each of those.
 *
 * Strategy: spawn the hook directly with carefully-crafted env, check
 * exit code (0 = allow, 2 = block) + stderr. The hook is a CJS
 * Node.js script with no other deps so this is fast (~50ms per spawn).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const HOOK = join(process.cwd(), 'bin', 'ecc-hooks.cjs');

// Reusable spawn helper. Sets only the env we explicitly pass; never
// inherits HOME or GRAWKUS_* from the test runner's environment.
function runHook(check: string, env: Record<string, string>): {
  exitCode: number; stdout: string; stderr: string;
} {
  const result = spawnSync('node', [HOOK, check, '__ecc__'], {
    env: {
      // Keep PATH so node can find itself, but strip everything else.
      PATH: process.env.PATH || '',
      ...env,
    },
    encoding: 'utf-8',
  });
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

describe('gateguard hook', () => {
  let tmpDir: string;
  let existingFile: string;
  let nonExistentFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gateguard-test-'));
    existingFile = join(tmpDir, 'existing.ts');
    nonExistentFile = join(tmpDir, 'brand-new.ts');
    writeFileSync(existingFile, 'export const x = 1;\n');
  });

  describe('yolo bypass (v1.27.1)', () => {
    it('returns ok() when GRAWKUS_PERMISSION_MODE=yolo', () => {
      const r = runHook('gateguard', {
        GRAWKUS_PERMISSION_MODE: 'yolo',
        GRAWKUS_TOOL_INPUT: JSON.stringify({ file_path: existingFile }),
        GRAWKUS_SESSION_ID: 'test-session',
      });
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toBe('');
    });

    it('keeps GRAWKUS_PERMISSION_MODE as the hook contract', () => {
      const r = runHook('gateguard', {
        GRAWKUS_PERMISSION_MODE: 'yolo',
        GRAWKUS_TOOL_INPUT: JSON.stringify({ file_path: existingFile }),
        GRAWKUS_SESSION_ID: 'test-session',
      });
      expect(r.exitCode).toBe(0);
    });

    it('does NOT bypass when permission mode is anything else (strict mode)', () => {
      // Run on an EXISTING file (not the new-file bypass) AND request
      // strict block mode so we know we'd see a block if yolo wasn't
      // the gating factor. Warn mode (the new default) wouldn't block
      // — that case has its own test below.
      const r = runHook('gateguard', {
        GRAWKUS_PERMISSION_MODE: 'ask',
        GRAWKUS_GATEGUARD_MODE: 'block',
        GRAWKUS_TOOL_INPUT: JSON.stringify({ file_path: existingFile }),
        GRAWKUS_SESSION_ID: `test-${Date.now()}`,
      });
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toContain('First Edit/Write');
    });
  });

  describe('env-var disable knob (v1.27.1)', () => {
    for (const val of ['off', 'OFF', 'false', '0', 'no', 'disabled']) {
      it(`returns ok() when GRAWKUS_GATEGUARD=${val}`, () => {
        const r = runHook('gateguard', {
          GRAWKUS_GATEGUARD: val,
          GRAWKUS_TOOL_INPUT: JSON.stringify({ file_path: existingFile }),
          GRAWKUS_SESSION_ID: `test-${Date.now()}`,
        });
        expect(r.exitCode).toBe(0);
      });
    }

    it('does NOT bypass on garbage env values (strict mode)', () => {
      const r = runHook('gateguard', {
        GRAWKUS_GATEGUARD: 'maybe',
        GRAWKUS_GATEGUARD_MODE: 'block',
        GRAWKUS_TOOL_INPUT: JSON.stringify({ file_path: existingFile }),
        GRAWKUS_SESSION_ID: `test-${Date.now()}`,
      });
      expect(r.exitCode).toBe(2);
    });
  });

  describe('mode selection (v1.29.1)', () => {
    it('default mode emits a warning hint and allows the edit', () => {
      const r = runHook('gateguard', {
        GRAWKUS_TOOL_INPUT: JSON.stringify({ file_path: existingFile }),
        GRAWKUS_SESSION_ID: `test-${Date.now()}`,
      });
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toContain('[ECC hint] first edit to');
    });

    it('block mode keeps the legacy block-first behavior', () => {
      const r = runHook('gateguard', {
        GRAWKUS_GATEGUARD_MODE: 'block',
        GRAWKUS_TOOL_INPUT: JSON.stringify({ file_path: existingFile }),
        GRAWKUS_SESSION_ID: `test-${Date.now()}`,
      });
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toContain('First Edit/Write');
    });

    it('off mode is fully silent', () => {
      const r = runHook('gateguard', {
        GRAWKUS_GATEGUARD_MODE: 'off',
        GRAWKUS_TOOL_INPUT: JSON.stringify({ file_path: existingFile }),
        GRAWKUS_SESSION_ID: `test-${Date.now()}`,
      });
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toBe('');
    });

    it('warn mode does not re-emit on second edit to same file', () => {
      const sessionId = `test-warn-${Date.now()}`;
      const r1 = runHook('gateguard', {
        GRAWKUS_TOOL_INPUT: JSON.stringify({ file_path: existingFile }),
        GRAWKUS_SESSION_ID: sessionId,
      });
      const r2 = runHook('gateguard', {
        GRAWKUS_TOOL_INPUT: JSON.stringify({ file_path: existingFile }),
        GRAWKUS_SESSION_ID: sessionId,
      });
      expect(r1.stderr).toContain('[ECC hint]');
      expect(r2.stderr).toBe('');  // already seen; no re-warn
      expect(r1.exitCode).toBe(0);
      expect(r2.exitCode).toBe(0);
    });
  });

  describe('non-existent file bypass (v1.27.2)', () => {
    it('returns ok() for a file that does not exist (warn mode)', () => {
      const r = runHook('gateguard', {
        GRAWKUS_TOOL_INPUT: JSON.stringify({ file_path: nonExistentFile }),
        GRAWKUS_SESSION_ID: `test-${Date.now()}`,
      });
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toBe('');  // no hint either, brand-new file is fully silent
      expect(existsSync(nonExistentFile)).toBe(false);
    });

    it('returns ok() for a file that does not exist (block mode)', () => {
      const r = runHook('gateguard', {
        GRAWKUS_GATEGUARD_MODE: 'block',
        GRAWKUS_TOOL_INPUT: JSON.stringify({ file_path: nonExistentFile }),
        GRAWKUS_SESSION_ID: `test-${Date.now()}`,
      });
      expect(r.exitCode).toBe(0);
    });

    it('blocks first edit to an EXISTING file (strict mode only)', () => {
      const r = runHook('gateguard', {
        GRAWKUS_GATEGUARD_MODE: 'block',
        GRAWKUS_TOOL_INPUT: JSON.stringify({ file_path: existingFile }),
        GRAWKUS_SESSION_ID: `test-${Date.now()}`,
      });
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toContain('First Edit/Write');
    });
  });

  describe('sessionId path-traversal sanitization (v1.28.1)', () => {
    // The state file is written under ~/.grawkus/state/gateguard/
    // <sessionId>.json. Without sanitization, a sessionId of
    // "../../../escape" would write outside that dir.
    const stateDir = join(homedir(), '.grawkus', 'state', 'gateguard');

    it('falls back to "unknown" on a path-traversal sessionId', () => {
      // Use a UNIQUE existing file so the per-file lock for "unknown"
      // can't have been set by an earlier test run. Use BLOCK mode so
      // we can assert exit code 2 (in warn mode the security still
      // applies but the surface signal is just an exit-0 hint).
      const uniqueFile = join(tmpDir, `unique-${Date.now()}.ts`);
      writeFileSync(uniqueFile, 'x');
      const r = runHook('gateguard', {
        GRAWKUS_GATEGUARD_MODE: 'block',
        GRAWKUS_TOOL_INPUT: JSON.stringify({ file_path: uniqueFile }),
        GRAWKUS_SESSION_ID: '../../../escape',
      });
      // Should block (block mode, existing file, no yolo) AND
      // should not have written outside the state dir.
      expect(r.exitCode).toBe(2);
      // The escape path must not have been created
      const traversalTarget = join(homedir(), '.grawkus', 'state', 'escape.json');
      expect(existsSync(traversalTarget)).toBe(false);
      // The "unknown" fallback path SHOULD exist
      const fallback = join(stateDir, 'unknown.json');
      // (only assert if the state dir exists — might not on fresh CI)
      if (existsSync(stateDir)) {
        expect(existsSync(fallback)).toBe(true);
      }
    });

    it('accepts valid sessionIds (alphanumeric + dash + underscore, <=64)', () => {
      const r = runHook('gateguard', {
        GRAWKUS_GATEGUARD_MODE: 'block',
        GRAWKUS_TOOL_INPUT: JSON.stringify({ file_path: existingFile }),
        GRAWKUS_SESSION_ID: 'abc-123_DEF',
      });
      // Block (existing file, no bypass) but with the real session id
      expect(r.exitCode).toBe(2);
    });

    it('rejects shell-injection-style sessionIds', () => {
      const r = runHook('gateguard', {
        GRAWKUS_GATEGUARD_MODE: 'block',
        GRAWKUS_TOOL_INPUT: JSON.stringify({ file_path: existingFile }),
        GRAWKUS_SESSION_ID: 'foo;rm -rf /',
      });
      // Falls back to "unknown" silently; still blocks the existing-file edit
      expect(r.exitCode).toBe(2);
    });
  });

  describe('malformed tool input (v1.28.1 fail-closed fix)', () => {
    it('blocks when GRAWKUS_TOOL_INPUT is non-empty malformed JSON', () => {
      const r = runHook('gateguard', {
        GRAWKUS_TOOL_INPUT: 'not valid json {{{',
        GRAWKUS_SESSION_ID: 'test',
      });
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toContain('not valid JSON');
    });

    it('allows when tool input env var is empty/unset (legitimate for SessionStart events)', () => {
      const r = runHook('gateguard', {
        GRAWKUS_SESSION_ID: 'test',
      });
      // No tool input + no file_path → empty-path guard returns ok()
      expect(r.exitCode).toBe(0);
    });
  });

});

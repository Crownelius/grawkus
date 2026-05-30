/**
 * Coverage for resolveSessionRef in src/sessions.ts.
 *
 * The function exists because user testing showed /resume failing
 * 100% of the time: /sessions truncated IDs to 12 chars for display,
 * users copy-pasted, and the truncated ID didn't match any real
 * session file. resolveSessionRef makes the lookup forgiving — exact,
 * prefix, "last", wrapped-in-brackets — which is what users
 * naturally type.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CRITICAL: GRAWKUS_HOME must be set BEFORE the import that
// computes SESSIONS_DIR at module-load time. Each test re-imports
// to get a fresh module with the temp dir.
let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'sess-resolve-test-'));
  process.env.GRAWKUS_HOME = tmpHome;
  mkdirSync(join(tmpHome, 'sessions'), { recursive: true });
});

afterEach(() => {
  delete process.env.GRAWKUS_HOME;
  try { rmSync(tmpHome, { recursive: true, force: true }); } catch { /* noop */ }
});

function seedSession(id: string, updatedAt = '2026-05-21T00:00:00.000Z'): void {
  const session = {
    id, name: `Session ${id}`, cwd: '/tmp', model: 'm', provider: 'p',
    messages: [], createdAt: updatedAt, updatedAt, tokenCount: 0,
    turnCount: 0, mode: 'dev',
  };
  writeFileSync(
    join(tmpHome, 'sessions', `${id}.json`),
    JSON.stringify(session, null, 2),
    'utf-8',
  );
}

describe('resolveSessionRef', () => {
  it('returns exact ID when given the full ID', async () => {
    seedSession('mpkgb0l4-7c0xyz');
    const { resolveSessionRef } = await import('../src/sessions.js?t1');
    const result = resolveSessionRef('mpkgb0l4-7c0xyz');
    expect(result).toEqual({ id: 'mpkgb0l4-7c0xyz' });
  });

  it('returns the canonical ID when given a unique prefix', async () => {
    // THIS is the canonical bug — user pastes a prefix from the
    // (previously-truncated) /sessions display and expects it to work.
    seedSession('mpkgb0l4-7c0xyz');
    const { resolveSessionRef } = await import('../src/sessions.js?t2');
    const result = resolveSessionRef('mpkgb0l4-7c0');
    expect(result).toEqual({ id: 'mpkgb0l4-7c0xyz' });
  });

  it('strips angle brackets around the ref', async () => {
    seedSession('abc123-xyz789');
    const { resolveSessionRef } = await import('../src/sessions.js?t3');
    const result = resolveSessionRef('<abc123-xyz789>');
    expect(result).toEqual({ id: 'abc123-xyz789' });
  });

  it('strips matched quotes', async () => {
    seedSession('abc123-xyz789');
    const { resolveSessionRef } = await import('../src/sessions.js?t4');
    expect(resolveSessionRef('"abc123-xyz789"')).toEqual({ id: 'abc123-xyz789' });
    expect(resolveSessionRef("'abc123-xyz789'")).toEqual({ id: 'abc123-xyz789' });
  });

  it('handles whitespace from leading/trailing copy-paste', async () => {
    seedSession('abc123-xyz789');
    const { resolveSessionRef } = await import('../src/sessions.js?t5');
    expect(resolveSessionRef('  abc123-xyz789  ')).toEqual({ id: 'abc123-xyz789' });
  });

  describe('"last" / "latest" shortcut', () => {
    it('returns the most-recently-updated session', async () => {
      seedSession('old-aaa', '2026-05-01T00:00:00.000Z');
      seedSession('new-bbb', '2026-05-21T00:00:00.000Z');
      seedSession('mid-ccc', '2026-05-15T00:00:00.000Z');
      const { resolveSessionRef } = await import('../src/sessions.js?t6');
      expect(resolveSessionRef('last')).toEqual({ id: 'new-bbb' });
      expect(resolveSessionRef('latest')).toEqual({ id: 'new-bbb' });
    });

    it('returns an error when no sessions exist', async () => {
      const { resolveSessionRef } = await import('../src/sessions.js?t7');
      const result = resolveSessionRef('last');
      expect(result).toEqual({ error: 'no saved sessions' });
    });
  });

  describe('ambiguity + no-match', () => {
    it('returns candidates when the prefix matches multiple sessions', async () => {
      seedSession('mpkgb0l4-7c0aaa');
      seedSession('mpkgb0l4-7c0bbb');
      seedSession('completely-different-id');
      const { resolveSessionRef } = await import('../src/sessions.js?t8');
      const result = resolveSessionRef('mpkgb0l4-7c0');
      expect(result).toMatchObject({
        error: expect.stringContaining('ambiguous prefix'),
        candidates: expect.arrayContaining(['mpkgb0l4-7c0aaa', 'mpkgb0l4-7c0bbb']),
      });
    });

    it('returns no-match error when the prefix matches nothing', async () => {
      seedSession('one-session');
      const { resolveSessionRef } = await import('../src/sessions.js?t9');
      const result = resolveSessionRef('xxx');
      expect(result).toMatchObject({
        error: expect.stringContaining('no session ID starts with "xxx"'),
      });
    });

    it('returns error on empty input', async () => {
      const { resolveSessionRef } = await import('../src/sessions.js?t10');
      const result = resolveSessionRef('   ');
      expect(result).toMatchObject({ error: 'empty session reference' });
    });
  });
});

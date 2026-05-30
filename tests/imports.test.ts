import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { importStatus, rollbackImport, runImport, scanImportSources } from '../src/imports.js';

let tmpHome = '';
let grawkusHome = '';

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'grawkus-import-home-'));
  grawkusHome = mkdtempSync(join(tmpdir(), 'grawkus-import-state-'));
  process.env.GRAWKUS_HOME = grawkusHome;
});

afterEach(() => {
  delete process.env.GRAWKUS_HOME;
  try { rmSync(tmpHome, { recursive: true, force: true }); } catch { /* noop */ }
  try { rmSync(grawkusHome, { recursive: true, force: true }); } catch { /* noop */ }
});

function seedClaudeThread(fileName = 'thread-a.jsonl'): string {
  const root = join(tmpHome, '.claude', 'projects', 'C--Users-rsfit');
  mkdirSync(root, { recursive: true });
  const path = join(root, fileName);
  const rows = [
    JSON.stringify({
      type: 'user',
      timestamp: '2026-05-28T00:00:00.000Z',
      sessionId: 'claude-thread-1',
      cwd: 'C:\\Users\\rsfit',
      message: { role: 'user', content: 'hello from claude' },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-05-28T00:00:01.000Z',
      sessionId: 'claude-thread-1',
      message: { role: 'assistant', model: 'claude-sonnet-4', content: [{ type: 'text', text: 'hi there' }] },
    }),
  ];
  writeFileSync(path, rows.join('\n') + '\n', 'utf-8');
  return path;
}

describe('imports', () => {
  it('detects available sources from a home directory', () => {
    seedClaudeThread();
    mkdirSync(join(tmpHome, '.codex', 'sessions', '2026', '05', '28'), { recursive: true });
    mkdirSync(join(tmpHome, '.mempalace', 'session_notes'), { recursive: true });
    writeFileSync(join(tmpHome, '.mempalace', 'session_notes', 'note.md'), '# note\n', 'utf-8');

    const sources = scanImportSources({ homeDir: tmpHome });
    const claude = sources.find((s) => s.source === 'claude');
    const codex = sources.find((s) => s.source === 'codex');
    const mempalace = sources.find((s) => s.source === 'mempalace');

    expect(claude?.detected).toBe(true);
    expect((claude?.artifactsFound || 0) > 0).toBe(true);
    expect(codex?.detected).toBe(true);
    expect(mempalace?.detected).toBe(true);
  });

  it('imports a Claude thread into Grawkus sessions and is idempotent', () => {
    seedClaudeThread();

    const first = runImport('claude', { homeDir: tmpHome, cwd: 'C:\\Users\\rsfit' });
    expect(first.importedSessions).toBe(1);
    expect(first.importedArtifacts).toBe(1);
    expect(first.skippedArtifacts).toBe(0);
    expect(first.importedMessages).toBe(2);

    const second = runImport('claude', { homeDir: tmpHome, cwd: 'C:\\Users\\rsfit' });
    expect(second.importedSessions).toBe(0);
    expect(second.importedArtifacts).toBe(0);
    expect(second.skippedArtifacts).toBe(1);

    const status = importStatus();
    expect(status.sessionsImported).toBe(1);
    expect(status.bySource.claude.sessions).toBe(1);
  });

  it('rolls back imported sessions for a run id', () => {
    seedClaudeThread();
    const run = runImport('claude', { homeDir: tmpHome, cwd: 'C:\\Users\\rsfit' });
    expect(run.importedSessions).toBe(1);

    const ledgerRaw = readFileSync(join(grawkusHome, 'imports', 'ledger.jsonl'), 'utf-8').trim().split(/\r?\n/);
    expect(ledgerRaw.length).toBe(1);
    const record = JSON.parse(ledgerRaw[0]) as { importedId: string; runId: string };
    expect(existsSync(join(grawkusHome, 'sessions', `${record.importedId}.json`))).toBe(true);

    const rollback = rollbackImport(run.runId, 'C:\\Users\\rsfit');
    expect(rollback.deletedSessions).toBe(1);
    expect(existsSync(join(grawkusHome, 'sessions', `${record.importedId}.json`))).toBe(false);
  });
});


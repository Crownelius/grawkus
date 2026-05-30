import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempHome = '';
let tempCwd = '';

beforeEach(() => {
  vi.resetModules();
  tempHome = mkdtempSync(join(tmpdir(), 'grawkus-promode-mem-home-'));
  tempCwd = mkdtempSync(join(tmpdir(), 'grawkus-promode-mem-cwd-'));
  vi.stubEnv('GRAWKUS_HOME', tempHome);
});

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  rmSync(tempHome, { recursive: true, force: true });
  rmSync(tempCwd, { recursive: true, force: true });
});

describe('ProMode memory context', () => {
  it('includes MemPalace hits and diary in cycle context when memory enabled', async () => {
    const mempalace = await import('../src/mempalace/index.js');
    mempalace.addDrawer({
      wing: 'promode',
      room: 'ideas',
      content: 'User wants better test coverage on src/promode.',
      tags: ['tilw:I', 'promode'],
      scope: 'project',
      cwd: tempCwd,
    });
    mempalace.diaryWrite({
      agentName: 'promode',
      entry: 'Last cycle: security_review pass on bash tool.',
      cwd: tempCwd,
    });

    const { buildPromodeMemoryContext } = await import('../src/promode/memory-context.js');
    const ctx = buildPromodeMemoryContext({
      cwd: tempCwd,
      query: 'test coverage promode',
      memoryEnabled: true,
      retrievalLimit: 12,
    });

    expect(ctx).toContain('Recalled memory');
    expect(ctx).toContain('src/promode');
    expect(ctx).toContain('Diary');
    expect(ctx).toContain('security_review');
  });

  it('returns empty block when memory disabled', async () => {
    const { buildPromodeMemoryContext } = await import('../src/promode/memory-context.js');
    const ctx = buildPromodeMemoryContext({
      cwd: tempCwd,
      query: 'anything',
      memoryEnabled: false,
      retrievalLimit: 12,
    });
    expect(ctx.trim()).toBe('');
  });
});

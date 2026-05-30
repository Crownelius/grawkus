import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempHome = '';
let tempCwd = '';

function testConfig(memoryEnabled = true): any {
  return {
    provider: 'OpenRouter',
    model: 'test-model',
    memory: { enabled: memoryEnabled },
  };
}

beforeEach(() => {
  vi.resetModules();
  tempHome = mkdtempSync(join(tmpdir(), 'grawkus-mempalace-home-'));
  tempCwd = mkdtempSync(join(tmpdir(), 'grawkus-mempalace-cwd-'));
  vi.stubEnv('GRAWKUS_HOME', tempHome);
  vi.stubEnv('GRAWKUS_HOME', tempHome);
});

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  rmSync(tempHome, { recursive: true, force: true });
  rmSync(tempCwd, { recursive: true, force: true });
});

describe('MemPalace integration', () => {
  it('injects deterministic recalled memory when enabled and skips it when disabled or in design mode', async () => {
    const mempalace = await import('../src/mempalace/index.js');
    mempalace.addDrawer({
      wing: 'code',
      room: 'grawkus',
      content: 'OpenAI OAuth callback handling lives in src/openai-oauth.ts and login-flow coverage exercises it.',
      tags: ['oauth', 'login'],
      importance: 0.9,
      scope: 'project',
      cwd: tempCwd,
    });

    const { buildSystemPrompt } = await import('../src/system-prompt.js');
    const prompt = buildSystemPrompt(
      testConfig(true),
      tempCwd,
      'dev',
      'Where is the OpenAI OAuth callback handled?',
    );

    expect(prompt).toContain('# Recalled memory (MemPalace');
    expect(prompt).toContain('src/openai-oauth.ts');

    const disabled = buildSystemPrompt(
      testConfig(false),
      tempCwd,
      'dev',
      'Where is the OpenAI OAuth callback handled?',
    );
    expect(disabled).not.toContain('# Recalled memory (MemPalace');

    const design = buildSystemPrompt(
      testConfig(true),
      tempCwd,
      'design',
      'Where is the OpenAI OAuth callback handled?',
    );
    expect(design).not.toContain('# Recalled memory (MemPalace');
  });

  it('rejects non-write scopes instead of silently writing to project memory', async () => {
    const mempalace = await import('../src/mempalace/index.js');

    expect(() => mempalace.addDrawer({
      wing: 'code',
      room: 'grawkus',
      content: 'Invalid both scope should never be accepted.',
      scope: 'both' as any,
      cwd: tempCwd,
    })).toThrow(/Invalid memory write scope/);

    expect(() => mempalace.addDrawer({
      wing: 'code',
      room: 'grawkus',
      content: 'Invalid typo scope should never be accepted.',
      scope: 'temporary' as any,
      cwd: tempCwd,
    })).toThrow(/Invalid memory write scope/);

    const globalDrawer = mempalace.addDrawer({
      wing: 'preferences',
      room: 'user',
      content: 'The user prefers Vitest for JavaScript tests.',
      scope: 'auto',
      cwd: tempCwd,
    });
    expect(globalDrawer.scope).toBe('global');

    const projectDrawer = mempalace.addDrawer({
      wing: 'code',
      room: 'grawkus',
      content: 'The command palette implementation lives in src/command-palette.ts.',
      tags: ['code'],
      scope: 'auto',
      cwd: tempCwd,
    });
    expect(projectDrawer.scope).toBe('project');

    const { MemoryAddTool } = await import('../src/tools/memory.js');
    const result = await MemoryAddTool.call({
      wing: 'code',
      room: 'grawkus',
      content: 'Tool calls must reject scope both too.',
      scope: 'both',
    }, tempCwd);
    expect(result.isError).toBe(true);
    expect(result.output).toContain('Invalid memory write scope');
  });
});

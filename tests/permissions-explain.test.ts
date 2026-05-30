import { describe, expect, it } from 'vitest';
import { explainPermission } from '../src/permissions.js';
import type { GrawkusConfig } from '../src/types.js';
import type { Tool } from '../src/tools/types.js';

function config(permissionMode: GrawkusConfig['permissionMode'], extra: Partial<GrawkusConfig> = {}): GrawkusConfig {
  return {
    apiKey: 'sk-test',
    baseURL: 'https://example.test/v1',
    model: 'test-model',
    provider: 'Test',
    maxTokens: 128,
    temperature: 0.3,
    permissionMode,
    ...extra,
  };
}

function tool(name: string, flags: Partial<Tool> = {}): Tool {
  return {
    name,
    description: '',
    parameters: { type: 'object', properties: {} },
    isReadOnly: false,
    isDestructive: false,
    async call() {
      return { output: '', isError: false };
    },
    ...flags,
  };
}

describe('permission explanations', () => {
  it('explains bash execpolicy allow before permission-mode checks', () => {
    const result = explainPermission(
      tool('bash', { isDestructive: true }),
      { command: 'git status --short' },
      config('ask'),
    );

    expect(result.decision).toBe('allow');
    expect(result.lines.join('\n')).toContain('execpolicy: allow (git-read)');
  });

  it('explains forbidden execpolicy blocks before yolo', () => {
    const result = explainPermission(
      tool('bash', { isDestructive: true }),
      { command: 'shutdown now' },
      config('yolo'),
    );

    expect(result.decision).toBe('deny');
    expect(result.lines.join('\n')).toContain('blocked before the normal permission prompt');
  });

  it('explains destructive tools prompting in auto mode', () => {
    const result = explainPermission(
      tool('write_file', { isDestructive: true }),
      { file_path: 'src/app.ts' },
      config('auto'),
    );

    expect(result.decision).toBe('prompt');
    expect(result.reason).toBe('destructive tool in auto mode');
  });

  it('explains the always-allow list', () => {
    const result = explainPermission(
      tool('write_file', { isDestructive: true }),
      { file_path: 'src/app.ts' },
      config('ask', { alwaysAllowedTools: ['write_file'] }),
    );

    expect(result.decision).toBe('allow');
    expect(result.reason).toBe('always-allow list');
  });
});

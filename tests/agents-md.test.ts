import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyAgentToolInstructions,
  buildAgentsInstructionsPrompt,
  discoverAgentsInstructions,
  formatAgentsInstructionsReport,
  parseAgentsMarkdown,
  selectorMatches,
} from '../src/agents-md.js';
import { buildSystemPrompt } from '../src/system-prompt.js';
import type { Tool } from '../src/tools/types.js';
import type { GrawkusConfig } from '../src/types.js';

let tempRoot: string | null = null;

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

function tempRepo(): string {
  tempRoot = mkdtempSync(join(tmpdir(), 'grawkus-agents-md-'));
  mkdirSync(join(tempRoot, '.git'));
  return tempRoot;
}

function fakeTool(name: string): Tool {
  return {
    name,
    description: `${name} base description.`,
    parameters: { type: 'object', properties: {} },
    isReadOnly: true,
    isDestructive: false,
    async call() {
      return { output: 'ok', isError: false };
    },
  };
}

function config(model = 'openai/gpt-5.5'): GrawkusConfig {
  return {
    apiKey: 'test',
    baseURL: 'https://example.test/v1',
    model,
    provider: 'OpenRouter',
    maxTokens: 1000,
    temperature: 0.3,
    permissionMode: 'auto',
    memory: { enabled: false },
  };
}

describe('AGENTS.md parsing', () => {
  it('separates global, model-scoped, and tool-scoped sections', () => {
    const parsed = parseAgentsMarkdown(`
# Team rules
Prefer focused patches.

## Model: gpt-5.*
Use strict TypeScript reasoning.

## Tool: bash, read_file
Prefer short commands and bounded reads.

## Other
This returns to global instructions.
`);

    expect(parsed.global).toContain('Prefer focused patches.');
    expect(parsed.global).toContain('This returns to global instructions.');
    expect(parsed.global).not.toContain('Use strict TypeScript reasoning.');
    expect(parsed.modelSections).toEqual([
      { kind: 'model', selector: 'gpt-5.*', content: 'Use strict TypeScript reasoning.' },
    ]);
    expect(parsed.toolSections).toEqual([
      { kind: 'tool', selector: 'bash, read_file', content: 'Prefer short commands and bounded reads.' },
    ]);
  });

  it('matches exact selectors, regex-like selectors, and slash regex selectors', () => {
    expect(selectorMatches('bash', 'bash')).toBe(true);
    expect(selectorMatches('gpt-5.*', 'openai/gpt-5.5')).toBe(true);
    expect(selectorMatches('/^read_/', 'read_file')).toBe(true);
    expect(selectorMatches('write_file, edit_file', 'edit_file')).toBe(true);
    expect(selectorMatches('/[/', 'bash')).toBe(false);
  });
});

describe('AGENTS.md discovery and prompt integration', () => {
  it('discovers root-to-cwd AGENTS.md files and injects matching model sections', () => {
    const root = tempRepo();
    const appDir = join(root, 'packages', 'app');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(root, 'AGENTS.md'), `
Root global rule.

## Model: gpt-5.*
Root GPT rule.

## Model: claude
Claude-only rule.

## Tool: bash
Root bash rule.
`);
    writeFileSync(join(appDir, 'AGENTS.md'), `
App global rule.

## Model: openai/.*
App OpenAI rule.
`);

    const discovered = discoverAgentsInstructions(appDir);
    expect(discovered.files.map((file) => file.relativePath)).toEqual([
      'AGENTS.md',
      'packages/app/AGENTS.md',
    ]);

    const prompt = buildAgentsInstructionsPrompt(appDir, 'openai/gpt-5.5');
    expect(prompt).toContain('# AGENTS.md Instructions');
    expect(prompt).toContain('Root global rule.');
    expect(prompt).toContain('Root GPT rule.');
    expect(prompt).toContain('App global rule.');
    expect(prompt).toContain('App OpenAI rule.');
    expect(prompt).not.toContain('Claude-only rule.');
    expect(prompt).not.toContain('Root bash rule.');
  });

  it('appends matching tool-scoped sections to cloned tool descriptions', () => {
    const root = tempRepo();
    writeFileSync(join(root, 'AGENTS.md'), `
Global rule.

## Tool: bash
Use PowerShell-safe commands on Windows.

## Tool: /^read_/
Read only the smallest useful slice.
`);

    const bash = fakeTool('bash');
    const read = fakeTool('read_file');
    const write = fakeTool('write_file');
    const scoped = applyAgentToolInstructions([bash, read, write], root, 'openai/gpt-5.5');

    expect(scoped[0]).not.toBe(bash);
    expect(scoped[0].description).toContain('Use PowerShell-safe commands on Windows.');
    expect(scoped[1]).not.toBe(read);
    expect(scoped[1].description).toContain('Read only the smallest useful slice.');
    expect(scoped[2]).toBe(write);
    expect(scoped[2].description).not.toContain('PowerShell-safe');
  });

  it('uses scoped tool descriptions in the system prompt tool list', () => {
    const root = tempRepo();
    writeFileSync(join(root, 'AGENTS.md'), `
## Tool: bash
Run from repo root unless the user says otherwise.
`);

    const scoped = applyAgentToolInstructions([fakeTool('bash')], root, 'openai/gpt-5.5');
    const prompt = buildSystemPrompt(config(), root, 'dev', 'fix tests', scoped);

    expect(prompt).toContain('bash: bash base description.');
    expect(scoped[0].description).toContain('Run from repo root');
  });

  it('formats a local /agents report with active model and tool matches', () => {
    const root = tempRepo();
    writeFileSync(join(root, 'AGENTS.md'), `
Global rule.

## Model: gpt-5.*
Model rule.

## Tool: bash
Bash rule.
`);

    const report = formatAgentsInstructionsReport(root, 'openai/gpt-5.5', [fakeTool('bash')]);
    expect(report).toContain('AGENTS.md files (1)');
    expect(report).toContain('Model: openai/gpt-5.5');
    expect(report).toContain('model: gpt-5.*');
    expect(report).toContain('tool: bash -> bash');
  });
});

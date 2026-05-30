import { describe, expect, it, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getToolByName } from '../src/tools/index.js';
import {
  buildTodoStateBlock,
  clearTodoItems,
  getTodoItems,
  normalizeTodoItems,
  TodoWriteTool,
} from '../src/tools/todo.js';
import { buildSystemPrompt } from '../src/system-prompt.js';
import type { GrawkusConfig } from '../src/types.js';

let cwdToClean: string | null = null;

afterEach(() => {
  if (cwdToClean) {
    clearTodoItems(cwdToClean);
    rmSync(cwdToClean, { recursive: true, force: true });
    cwdToClean = null;
  }
});

function tempCwd(): string {
  cwdToClean = mkdtempSync(join(tmpdir(), 'grawkus-todo-'));
  return cwdToClean;
}

describe('todo_write tool', () => {
  it('is registered in the tool surface', () => {
    expect(getToolByName('todo_write')).toBe(TodoWriteTool);
  });

  it('normalizes strings, markdown checkboxes, and object items', () => {
    expect(normalizeTodoItems([
      'Inspect repo',
      '- [x] Run tests',
      '- [-] Patch bug',
      { content: 'Summarize evidence', status: 'completed' },
      { task: 'Ignored status defaults pending' },
      '',
    ])).toEqual([
      { content: 'Inspect repo', status: 'pending' },
      { content: 'Run tests', status: 'completed' },
      { content: 'Patch bug', status: 'in_progress' },
      { content: 'Summarize evidence', status: 'completed' },
      { content: 'Ignored status defaults pending', status: 'pending' },
    ]);
  });

  it('stores the current working todo list by cwd and renders it for injection', async () => {
    const cwd = tempCwd();
    const result = await TodoWriteTool.call({
      items: [
        { content: 'Inspect task', status: 'completed' },
        { content: 'Patch root cause', status: 'in_progress' },
        { content: 'Run verifier', status: 'pending' },
      ],
    }, cwd);

    expect(result.isError).toBe(false);
    expect(getTodoItems(cwd)).toHaveLength(3);
    const block = buildTodoStateBlock(cwd);
    expect(block).toContain('<current_plan>');
    expect(block).toContain('- [x] Inspect task');
    expect(block).toContain('- [-] Patch root cause');
    expect(block).toContain('- [ ] Run verifier');
  });

  it('clears the list when called with no valid items', async () => {
    const cwd = tempCwd();
    await TodoWriteTool.call({ items: ['Do work'] }, cwd);
    await TodoWriteTool.call({ items: [] }, cwd);
    expect(getTodoItems(cwd)).toEqual([]);
    expect(buildTodoStateBlock(cwd)).toBeNull();
  });
});

describe('todo prompt guidance', () => {
  it('tells the model when to use todo_write', () => {
    const cwd = tempCwd();
    const cfg: GrawkusConfig = {
      apiKey: 'test',
      baseURL: 'https://example.test/v1',
      model: 'openrouter/free',
      provider: 'OpenRouter',
      maxTokens: 1000,
      temperature: 0.3,
      permissionMode: 'auto',
      memory: { enabled: false },
    };
    const prompt = buildSystemPrompt(cfg, cwd, 'benchmark', 'fix a multi-step task');
    expect(prompt).toContain('todo_write');
    expect(prompt).toContain('multi-step work');
    expect(prompt).toContain('benchmark_repo_catalog');
    expect(prompt).toContain('github_repo_digest');
  });

  it('guards benchmark skill disclosure with context-first fit checks', () => {
    const cwd = tempCwd();
    const cfg: GrawkusConfig = {
      apiKey: 'test',
      baseURL: 'https://example.test/v1',
      model: 'openrouter/free',
      provider: 'OpenRouter',
      maxTokens: 1000,
      temperature: 0.3,
      permissionMode: 'auto',
      memory: { enabled: false },
    };
    const prompt = buildSystemPrompt(cfg, cwd, 'benchmark', 'fix a typescript react test failure');
    expect(prompt).toContain('# Relevant skills (Level 0');
    expect(prompt).toContain('inspect `benchmark_context` and local repo evidence before loading a full skill');
    expect(prompt).toContain('load at most one strongly domain/version-matched skill');
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HarnessComponentsTool, _internal } from '../src/tools/harness-components.js';
import { getToolByName, getToolNames } from '../src/tools/index.js';

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'grawkus-harness-'));
  roots.push(root);
  return root;
}

function write(root: string, path: string, content = ''): void {
  const full = join(root, ...path.split('/'));
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('harness_components tool', () => {
  it('is registered as a read-only tool', () => {
    expect(getToolNames()).toContain('harness_components');
    expect(getToolByName('harness_components')).toBe(HarnessComponentsTool);
    expect(HarnessComponentsTool.isReadOnly).toBe(true);
    expect(HarnessComponentsTool.isDestructive).toBe(false);
  });

  it('maps Grawkus harness surfaces to files, tests, docs, and edit contracts', async () => {
    const root = makeRoot();
    write(root, 'package.json', JSON.stringify({ name: 'grawkus', version: '9.9.9' }));
    write(root, 'src/system-prompt.ts');
    write(root, 'src/modes.ts');
    write(root, 'src/tools/bash.ts');
    write(root, 'src/tools/research-sources.ts');
    write(root, 'src/query.ts');
    write(root, 'src/live-queue.ts');
    write(root, 'src/mempalace/index.ts');
    write(root, 'src/tools/memory.ts');
    write(root, 'src/openai-oauth.ts');
    write(root, 'src/openai-smoke.ts');
    write(root, 'src/command-palette.ts');
    write(root, 'resources/ecc/skills/example/SKILL.md');
    write(root, 'resources/ecc/agents/planner.md');
    write(root, 'resources/terminal_bench/grawkus_agent.py');
    write(root, 'bench/README.md');
    write(root, 'README.md');
    write(root, 'COMMANDS.md');
    write(root, 'tests/query-liveness.test.ts');
    write(root, 'tests/openai-oauth.test.ts');
    write(root, 'tests/research-sources.test.ts');
    write(root, 'tests/terminal-bench-adapter.test.ts');
    write(root, 'tests/smoke-commands.test.ts');

    const result = await HarnessComponentsTool.call({ path: root, max_files_per_component: 6 }, process.cwd());

    expect(result.isError).toBe(false);
    expect(result.output).toContain('Package: grawkus@9.9.9');
    expect(result.output).toContain('System Prompts And Modes');
    expect(result.output).toContain('Tool Descriptions And Implementations');
    expect(result.output).toContain('Runtime Middleware And Turn Control');
    expect(result.output).toContain('Long-Term Memory');
    expect(result.output).toContain('Providers, Models, And Auth');
    expect(result.output).toContain('Benchmark Adapters And Evidence Artifacts');
    expect(result.output).toContain('CLI UX, Slash Commands, And Accessibility');
    expect(result.output).toContain('src/openai-oauth.ts');
    expect(result.output).toContain('tests/openai-oauth.test.ts');
    expect(result.output).toContain('Prediction:');
    expect(result.output).not.toContain('hf_');
    expect(result.output).not.toContain('sk-or-v1-');
  });

  it('emits machine-readable component observability JSON', async () => {
    const root = makeRoot();
    write(root, 'package.json', JSON.stringify({ name: 'grawkus', version: '9.9.9' }));
    write(root, 'src/openai-oauth.ts');
    write(root, 'src/openai-smoke.ts');
    write(root, 'tests/openai-oauth.test.ts');
    write(root, 'README.md');
    write(root, 'COMMANDS.md');

    const result = await HarnessComponentsTool.call({
      path: root,
      component: 'providers',
      format: 'json',
    }, process.cwd());

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.output);
    expect(parsed.format).toBe('grawkus-harness-components-v1');
    expect(parsed.package).toBe('grawkus@9.9.9');
    expect(parsed.summary).toMatchObject({
      totalComponents: 10,
      shownComponents: 1,
      componentIds: ['providers'],
    });
    expect(parsed.redaction).toMatchObject({
      secretsIncluded: false,
      memoryContentsIncluded: false,
      oracleContentsIncluded: false,
    });
    expect(parsed.components).toHaveLength(1);
    expect(parsed.components[0]).toMatchObject({
      id: 'providers',
      title: 'Providers, Models, And Auth',
      files: ['src/openai-oauth.ts', 'src/openai-smoke.ts'],
      tests: ['tests/openai-oauth.test.ts'],
      docs: ['COMMANDS.md', 'README.md'],
    });
    expect(result.output).toContain('Prediction:');
    expect(result.output).not.toContain('sk-or-v1-');
  });

  it('filters to one component and rejects unsupported filters', () => {
    const root = makeRoot();
    write(root, 'package.json', JSON.stringify({ name: 'grawkus' }));
    write(root, 'src/openai-oauth.ts');
    write(root, 'tests/openai-oauth.test.ts');

    const providers = _internal.buildHarnessComponentsReport({ path: root, component: 'providers' }, process.cwd());
    expect(providers.isError).toBe(false);
    expect(providers.output).toContain('components: 1 shown');
    expect(providers.output).toContain('Providers, Models, And Auth');
    expect(providers.output).not.toContain('Long-Term Memory');

    const bad = _internal.buildHarnessComponentsReport({ path: root, component: 'bogus' }, process.cwd());
    expect(bad.isError).toBe(true);
    expect(bad.output).toContain('unsupported component');

    const badFormat = _internal.buildHarnessComponentsReport({ path: root, format: 'xml' }, process.cwd());
    expect(badFormat.isError).toBe(true);
    expect(badFormat.output).toContain('unsupported format');
  });

  it('reports missing paths cleanly', () => {
    const result = _internal.buildHarnessComponentsReport({ path: join(tmpdir(), 'no-such-grawkus-harness') }, process.cwd());
    expect(result.isError).toBe(true);
    expect(result.output).toContain('path does not exist');
  });
});

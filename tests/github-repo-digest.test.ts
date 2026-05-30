import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubRepoDigestTool, _internal } from '../src/tools/github-repo-digest.js';
import { getToolNames } from '../src/tools/index.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('github_repo_digest tool', () => {
  it('is registered as a read-only tool', () => {
    expect(getToolNames()).toContain('github_repo_digest');
    expect(GitHubRepoDigestTool.isReadOnly).toBe(true);
    expect(GitHubRepoDigestTool.isDestructive).toBe(false);
  });

  it('parses common GitHub repository references', () => {
    expect(_internal.parseGitHubRepo('openai/codex')).toEqual({ owner: 'openai', repo: 'codex' });
    expect(_internal.parseGitHubRepo('https://github.com/google-gemini/gemini-cli')).toEqual({ owner: 'google-gemini', repo: 'gemini-cli' });
    expect(_internal.parseGitHubRepo('git@github.com:anthropics/claude-code.git')).toEqual({ owner: 'anthropics', repo: 'claude-code' });
    expect(_internal.parseGitHubRepo('not-a-repo')).toBeNull();
  });

  it('formats repository metadata, component signals, commands, and redacted excerpts', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'ghp_test_token');
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(url);
      if (url === 'https://api.github.com/repos/openai/codex') {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer ghp_test_token');
        return Response.json({
          full_name: 'openai/codex',
          html_url: 'https://github.com/openai/codex',
          description: 'Open-source coding agent',
          stargazers_count: 12345,
          forks_count: 321,
          open_issues_count: 17,
          language: 'Rust',
          pushed_at: '2026-05-27T00:00:00Z',
          updated_at: '2026-05-27T00:00:00Z',
          default_branch: 'main',
          license: { spdx_id: 'Apache-2.0' },
          topics: ['agent', 'coding'],
        });
      }
      if (url === 'https://api.github.com/repos/openai/codex/git/trees/main?recursive=1') {
        return Response.json({
          truncated: false,
          tree: [
            { type: 'blob', path: 'README.md', size: 1000 },
            { type: 'blob', path: 'package.json', size: 300 },
            { type: 'blob', path: 'src/tools/bash.ts', size: 200 },
            { type: 'blob', path: 'src/middleware/loop.ts', size: 200 },
            { type: 'blob', path: 'resources/skills/agent/README.md', size: 200 },
            { type: 'blob', path: 'bench/terminal-bench/adapter.py', size: 200 },
            { type: 'blob', path: '.github/workflows/test.yml', size: 200 },
          ],
        });
      }
      if (url === 'https://raw.githubusercontent.com/openai/codex/main/README.md') {
        return new Response([
          '# Codex',
          'Install with npm install -g codex',
          'Run cargo test before release.',
        ].join('\n'));
      }
      if (url === 'https://raw.githubusercontent.com/openai/codex/main/package.json') {
        return Response.json({
          scripts: {
            test: 'vitest run',
            leak: ['echo ', 'sk-or-v1-', 'abcdefghijklmnopqrstuvwxyz1234567890'].join(''),
          },
        });
      }
      return new Response('', { status: 404 });
    }));

    const result = await GitHubRepoDigestTool.call({
      repo: 'openai/codex',
      max_files: 50,
      max_text_files: 2,
      max_excerpt_chars: 1000,
    }, process.cwd());

    expect(result.isError).toBe(false);
    expect(result.output).toContain('# GitHub Repo Digest');
    expect(result.output).toContain('Repo: openai/codex');
    expect(result.output).toContain('- stars: 12,345');
    expect(result.output).toContain('- manifests: package.json');
    expect(result.output).toContain('- ci_files: .github/workflows/test.yml');
    expect(result.output).toContain('- tools: 1');
    expect(result.output).toContain('- middleware: 1');
    expect(result.output).toContain('- benchmarks/evals:');
    expect(result.output).toContain('package script test: vitest run');
    expect(result.output).toContain('README.md: Install with npm install -g codex');
    expect(result.output).toContain('sk-or-v1-[REDACTED]');
    expect(result.output).not.toContain('abcdefghijklmnopqrstuvwxyz1234567890');
    expect(result.output).not.toContain('ghp_test_token');
    expect(urls).toContain('https://api.github.com/repos/openai/codex');
  });

  it('supports docs-only digests that skip source-code excerpts', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      if (url === 'https://api.github.com/repos/openai/codex') {
        return Response.json({
          full_name: 'openai/codex',
          html_url: 'https://github.com/openai/codex',
          description: 'Open-source coding agent',
          stargazers_count: 1,
          forks_count: 1,
          open_issues_count: 0,
          language: 'Rust',
          pushed_at: '2026-05-27T00:00:00Z',
          updated_at: '2026-05-27T00:00:00Z',
          default_branch: 'main',
          license: { spdx_id: 'Apache-2.0' },
          topics: [],
        });
      }
      if (url === 'https://api.github.com/repos/openai/codex/git/trees/main?recursive=1') {
        return Response.json({
          truncated: false,
          tree: [
            { type: 'blob', path: 'README.md', size: 1000 },
            { type: 'blob', path: 'docs/architecture.md', size: 1000 },
            { type: 'blob', path: 'src/agent.ts', size: 1000 },
          ],
        });
      }
      if (url === 'https://raw.githubusercontent.com/openai/codex/main/README.md') {
        return new Response('# Codex docs');
      }
      if (url === 'https://raw.githubusercontent.com/openai/codex/main/docs/architecture.md') {
        return new Response('# Architecture docs');
      }
      return new Response('', { status: 404 });
    }));

    const result = await GitHubRepoDigestTool.call({
      repo: 'openai/codex',
      max_files: 50,
      max_text_files: 2,
      docs_only: true,
    }, process.cwd());

    expect(result.isError).toBe(false);
    expect(result.output).toContain('- docs_only: yes');
    expect(result.output).toContain('source_code_guard');
    expect(urls).toContain('https://raw.githubusercontent.com/openai/codex/main/README.md');
    expect(urls).not.toContain('https://raw.githubusercontent.com/openai/codex/main/src/agent.ts');
  });

  it('selects key files in stable priority order', () => {
    expect(_internal.selectKeyFiles([
      'src/agent.py',
      'README.md',
      'package.json',
      'bench/eval.md',
    ], 3)).toEqual(['README.md', 'package.json', 'src/agent.py']);
    expect(_internal.selectKeyFiles([
      'src/agent.py',
      'README.md',
      'docs/architecture.md',
    ], 3, true)).toEqual(['README.md', 'docs/architecture.md']);
  });

  it('reserves bounded analysis slots for root key files before sorted dot-directories', () => {
    expect(_internal.selectAnalysisPaths([
      '.github/workflows/ci.yml',
      '.hidden/a.ts',
      'README.md',
      'package.json',
      'src/index.ts',
    ], 3)).toEqual(['README.md', 'package.json', 'src/index.ts']);
  });
});

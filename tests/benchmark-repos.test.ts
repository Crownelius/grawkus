import { describe, expect, it } from 'vitest';
import {
  BenchmarkRepoCatalogTool,
  decodeBenchmarkReposSentinel,
  encodeBenchmarkReposSentinel,
  filterBenchmarkRepoCatalog,
  formatBenchmarkRepoCatalog,
  formatBenchmarkRepoCatalogUsage,
  parseBenchmarkRepoCatalogCommandArgs,
  selectBenchmarkRepoDigestTarget,
  selectTopOpenSourceBenchmarkRepos,
  TERMINAL_BENCH_REPO_CATALOG,
  _internal,
} from '../src/benchmark-repos.js';
import { getToolNames } from '../src/tools/index.js';

describe('benchmark repo catalog', () => {
  it('registers a read-only tool', () => {
    expect(getToolNames()).toContain('benchmark_repo_catalog');
    expect(BenchmarkRepoCatalogTool.isReadOnly).toBe(true);
    expect(BenchmarkRepoCatalogTool.isDestructive).toBe(false);
  });

  it('contains official and related Terminal-Bench source mappings', () => {
    expect(TERMINAL_BENCH_REPO_CATALOG.length).toBeGreaterThanOrEqual(45);
    expect(TERMINAL_BENCH_REPO_CATALOG.some((entry) =>
      entry.project === 'Codex CLI' && entry.repos.some((repo) => repo.slug === 'openai/codex'),
    )).toBe(true);
    expect(TERMINAL_BENCH_REPO_CATALOG.some((entry) =>
      entry.project === 'Meta-Harness' && entry.status === 'related',
    )).toBe(true);
    expect(TERMINAL_BENCH_REPO_CATALOG.some((entry) =>
      entry.project === 'JJAgent' && entry.status === 'unverified' && entry.repos.length === 0,
    )).toBe(true);
    expect(_internal.bestLeaderboardSnapshot(
      TERMINAL_BENCH_REPO_CATALOG.find((entry) => entry.project === 'NexAU-AHE')!,
    )?.rank).toBe(3);
  });

  it('formats a bounded catalog with next-step repo digest guidance', () => {
    const output = formatBenchmarkRepoCatalog({ query: 'openhands', status: 'all', limit: 5 });

    expect(output).toContain('Terminal-Bench Public Repo Catalog');
    expect(output).toContain('OpenHands/openhands');
    expect(output).toContain('Source: Terminal-Bench 2.0 public source mapping report');
    expect(output).toContain('no-public-source gaps');
    expect(output).toContain('/repo-digest <owner/repo>');
  });

  it('selects top open-source repo targets from the current top 20 without overclaiming gaps', () => {
    const selected = selectTopOpenSourceBenchmarkRepos({ leaderboardTop: 20, limit: 10 });
    const slugs = selected.map((item) => item.repo.slug);

    expect(slugs).toContain('china-qijizhifeng/agentic-harness-engineering');
    expect(slugs).toContain('Open-Lemon/LemonAgent');
    expect(slugs).toContain('openai/codex');
    expect(slugs).toContain('WithWoz/wozcode-plugin');
    expect(slugs).toContain('coder/mux');
    expect(slugs).not.toContain('kirby88/vix-releases');
    expect(selected.length).toBeLessThan(10);
    expect(selected.every((item) => item.leaderboard.rank <= 20)).toBe(true);
  });

  it('formats top open-source mode with docs-only repo-digest guidance and skipped gaps', () => {
    const output = formatBenchmarkRepoCatalog({ top_open_source: true, leaderboard_top: 20, limit: 10 });

    expect(output).toContain('Terminal-Bench Top Open-Source Repo Targets');
    expect(output).toContain('Verified repo targets:');
    expect(output).toContain('docs_only=yes');
    expect(output).toContain('/repo-digest openai/codex --files 500 --docs-only');
    expect(output).toContain('#2 JJAgent: no verified public implementation repository');
    expect(output).toContain('#1 vix: release-only repository');
  });

  it('filters by query and status', () => {
    const official = filterBenchmarkRepoCatalog({ query: 'codex', status: 'official' });
    const all = filterBenchmarkRepoCatalog({ query: 'codex', status: 'all' });

    expect(official.map((entry) => entry.project)).toContain('Codex CLI');
    expect(official.map((entry) => entry.project)).not.toContain('Simple Codex');
    expect(all.map((entry) => entry.project)).toContain('Simple Codex');
  });

  it('surfaces known no-public-source gaps without repo slugs', () => {
    const missing = filterBenchmarkRepoCatalog({ query: 'sage', status: 'unverified' });
    expect(missing.map((entry) => entry.project)).toContain('SageAgent');

    const output = formatBenchmarkRepoCatalog({ query: 'sage', status: 'unverified', limit: 5 });
    expect(output).toContain('SageAgent [unverified');
    expect(output).toContain('repos: (none verified)');
    expect(output).toContain('do not overclaim unverified gaps');

    const reposOnly = formatBenchmarkRepoCatalog({ query: 'sage', status: 'unverified', repos_only: true });
    expect(reposOnly).toBe('');
  });

  it('parses slash command flags and sentinel payloads', () => {
    const parsed = parseBenchmarkRepoCatalogCommandArgs('"terminal-agent" --all --limit 20 --repos-only --digest');

    expect(parsed.error).toBeUndefined();
    expect(parsed.input).toMatchObject({
      query: 'terminal-agent',
      status: 'all',
      limit: 20,
      repos_only: true,
      digest: true,
    });

    const unverified = parseBenchmarkRepoCatalogCommandArgs('--no-source --limit=20');
    expect(unverified.error).toBeUndefined();
    expect(unverified.input).toMatchObject({
      status: 'unverified',
      limit: 20,
    });

    const encoded = encodeBenchmarkReposSentinel(parsed.input!);
    expect(encoded.startsWith('__BENCHMARK_REPOS__')).toBe(true);
    expect(decodeBenchmarkReposSentinel(encoded)).toEqual(parsed.input);

    const top = parseBenchmarkRepoCatalogCommandArgs('--top-open-source --from-top 20 --limit 10 --docs-only');
    expect(top.error).toBeUndefined();
    expect(top.input).toMatchObject({
      top_open_source: true,
      leaderboard_top: 20,
      limit: 10,
      docs_only: true,
    });
  });

  it('selects the first verified repo as the digest target', () => {
    expect(selectBenchmarkRepoDigestTarget({ query: 'nexau', status: 'all' }))
      .toBe('china-qijizhifeng/agentic-harness-engineering');
    expect(selectBenchmarkRepoDigestTarget({ query: 'sage', status: 'unverified' }))
      .toBeNull();
  });

  it('rejects unknown options with helpful usage', () => {
    const parsed = parseBenchmarkRepoCatalogCommandArgs('--unknown');

    expect(parsed.error).toContain('unknown option');
    expect(formatBenchmarkRepoCatalogUsage()).toContain('/benchmark-repos');
    expect(formatBenchmarkRepoCatalogUsage()).toContain('--unverified');
    expect(formatBenchmarkRepoCatalogUsage()).toContain('--digest');
    expect(formatBenchmarkRepoCatalogUsage()).toContain('--top-open-source');
    expect(_internal.tokenizeArgs('"open ai" --all')).toEqual(['open ai', '--all']);
    expect(_internal.normalizeStatusAlias('missing')).toBe('unverified');
  });
});

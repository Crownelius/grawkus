import type { Tool, ToolResult } from './tools/types.js';

export type BenchmarkRepoStatus = 'official' | 'related' | 'unverified';

export interface BenchmarkRepoRef {
  slug: string;
  role?: string;
}

export interface BenchmarkLeaderboardSnapshot {
  rank: number;
  scorePct: number;
  model: string;
  date: string;
  source: string;
  note?: string;
}

export interface BenchmarkRepoEntry {
  project: string;
  status: BenchmarkRepoStatus;
  repos: BenchmarkRepoRef[];
  tags: string[];
  note: string;
  lastSeen?: string;
  leaderboard?: BenchmarkLeaderboardSnapshot[];
}

export interface BenchmarkRepoCatalogParseResult {
  input?: Record<string, unknown>;
  error?: string;
}

const CATALOG_SOURCE = 'Terminal-Bench 2.0 public source mapping report, reviewed 2026-05-27';
const LEADERBOARD_SOURCE = 'Official Terminal-Bench 2.0 leaderboard, read 2026-05-28';

export const TERMINAL_BENCH_REPO_CATALOG: BenchmarkRepoEntry[] = [
  {
    project: 'NexAU-AHE',
    status: 'official',
    repos: [{ slug: 'china-qijizhifeng/agentic-harness-engineering' }],
    tags: ['terminal-bench', 'harness', 'ahe'],
    note: 'Official submission metadata points directly to the agentic-harness-engineering repo.',
    lastSeen: '2026-05-27',
    leaderboard: [{ rank: 3, scorePct: 84.7, model: 'GPT-5.5', date: '2026-05-14', source: LEADERBOARD_SOURCE }],
  },
  {
    project: 'LemonHarness',
    status: 'official',
    repos: [{ slug: 'Open-Lemon/LemonAgent' }],
    tags: ['terminal-bench', 'agent', 'harness'],
    note: 'Official submission maps LemonHarness to the LemonAgent repo.',
    lastSeen: '2026-02-10',
    leaderboard: [
      { rank: 4, scorePct: 84.5, model: 'Multiple', date: '2026-05-14', source: LEADERBOARD_SOURCE },
      { rank: 10, scorePct: 79.9, model: 'Multiple', date: '2026-05-14', source: LEADERBOARD_SOURCE },
    ],
  },
  {
    project: 'Codex CLI',
    status: 'official',
    repos: [{ slug: 'openai/codex' }],
    tags: ['terminal-agent', 'rust', 'cli', 'openai'],
    note: 'Official OpenAI terminal coding agent repository.',
    lastSeen: '2026-05-27',
    leaderboard: [{ rank: 6, scorePct: 82.2, model: 'GPT-5.5', date: '2026-04-23', source: LEADERBOARD_SOURCE }],
  },
  {
    project: 'WOZCODE',
    status: 'official',
    repos: [
      { slug: 'WithWoz/wozcode-plugin', role: 'public Claude Code plugin repo' },
    ],
    tags: ['claude-code', 'plugin', 'terminal-bench'],
    note: 'Submission materials reference WozCode; the public plugin repo identifies WOZCODE as a Claude Code plugin. A separate full-source repo was not verified.',
    lastSeen: '2026-05-22',
    leaderboard: [{ rank: 9, scorePct: 80.2, model: 'Claude Opus 4.7', date: '2026-05-14', source: LEADERBOARD_SOURCE }],
  },
  {
    project: 'Codelia',
    status: 'official',
    repos: [{ slug: 'kousw/codelia' }],
    tags: ['terminal-bench', 'agent'],
    note: 'Official submission metadata links directly to the codelia repo.',
    lastSeen: '2026-05-17',
    leaderboard: [{ rank: 15, scorePct: 75.7, model: 'GPT-5.3-Codex', date: '2026-05-14', source: LEADERBOARD_SOURCE }],
  },
  {
    project: 'Mux',
    status: 'official',
    repos: [{ slug: 'coder/mux' }],
    tags: ['terminal-bench', 'coder', 'agent'],
    note: 'Official submission metadata links directly to Coder mux.',
    lastSeen: '2026-05-27',
    leaderboard: [{ rank: 20, scorePct: 74.6, model: 'GPT-5.3-Codex', date: '2026-03-06', source: LEADERBOARD_SOURCE }],
  },
  {
    project: 'Crux',
    status: 'official',
    repos: [{ slug: '0xDarkMatter/crux-agent' }],
    tags: ['terminal-bench', 'agent'],
    note: 'Official metadata maps Crux to crux-agent; commit-history evidence was incomplete in the report.',
  },
  {
    project: 'Deep Agents',
    status: 'official',
    repos: [{ slug: 'langchain-ai/deepagents' }],
    tags: ['langchain', 'agent-harness', 'python'],
    note: 'LangChain repository for a batteries-included agent harness.',
    lastSeen: '2026-05-27',
  },
  {
    project: 'clnkr',
    status: 'official',
    repos: [{ slug: 'clnkr-ai/clnkr' }],
    tags: ['go', 'cli', 'coding-agent'],
    note: 'Coding-agent CLI with upstream-maintained public repository.',
    lastSeen: '2026-05-24',
  },
  {
    project: 'II-Agent',
    status: 'official',
    repos: [{ slug: 'intelligent-internet/ii-agent' }],
    tags: ['python', 'agent-framework'],
    note: 'Open-source agent framework under the Intelligent Internet organization.',
    lastSeen: '2026-04-13',
  },
  {
    project: 'Warp',
    status: 'official',
    repos: [{ slug: 'warpdotdev/warp' }],
    tags: ['terminal', 'agentic-development-environment'],
    note: 'Official Warp product repository; broader than the benchmark harness but same product family.',
    lastSeen: '2026-05-27',
  },
  {
    project: 'Gemini CLI',
    status: 'official',
    repos: [{ slug: 'google-gemini/gemini-cli' }],
    tags: ['google', 'terminal-agent', 'cli'],
    note: 'Official Google Gemini CLI terminal agent repository.',
    lastSeen: '2026-05-26',
  },
  {
    project: 'Letta Code',
    status: 'official',
    repos: [{ slug: 'letta-ai/letta-code' }],
    tags: ['memory', 'coding-agent'],
    note: 'Memory-first coding agent under Letta.',
    lastSeen: '2026-05-27',
  },
  {
    project: 'Abacus AI Desktop',
    status: 'official',
    repos: [
      { slug: 'abacusai/abacusai-desktop', role: 'desktop and CLI product' },
      { slug: 'abacusai/DeepAgent', role: 'agent engine repo referenced by benchmark materials' },
    ],
    tags: ['desktop', 'cli', 'agent'],
    note: 'Implementation appears split across desktop/CLI product and DeepAgent engine repos.',
    lastSeen: '2026-03-17',
  },
  {
    project: 'Claude Code',
    status: 'official',
    repos: [{ slug: 'anthropics/claude-code' }],
    tags: ['anthropic', 'terminal-agent', 'cli'],
    note: 'Official Anthropic terminal coding tool repository.',
    lastSeen: '2026-05-27',
  },
  {
    project: 'Grok CLI',
    status: 'official',
    repos: [{ slug: 'superagent-ai/grok-cli' }],
    tags: ['typescript', 'cli', 'grok'],
    note: 'Open-source coding agent for Grok API; community-built but official for the Superagent leaderboard entry.',
    lastSeen: '2026-05-15',
  },
  {
    project: 'Goose',
    status: 'official',
    repos: [{ slug: 'aaif-goose/goose' }],
    tags: ['rust', 'cli', 'desktop', 'agent'],
    note: 'Open-source general-purpose agent with desktop, CLI, and API surfaces.',
    lastSeen: '2026-05-27',
  },
  {
    project: 'OpenHands',
    status: 'official',
    repos: [{ slug: 'OpenHands/openhands' }],
    tags: ['python', 'coding-agent', 'platform'],
    note: 'Official OpenHands open-source platform repository.',
    lastSeen: '2026-05-27',
  },
  {
    project: 'OpenCode',
    status: 'official',
    repos: [{ slug: 'anomalyco/opencode' }],
    tags: ['typescript', 'coding-agent', 'cli'],
    note: 'Official open-source coding agent from Anomaly.',
    lastSeen: '2026-05-27',
  },
  {
    project: 'cchuter',
    status: 'official',
    repos: [{ slug: 'cchuter/blobfish' }],
    tags: ['terminal-bench', 'agent', 'blobfish'],
    note: 'Team Blobfish repo documents a username-mapped cchuter agent.',
    lastSeen: '2026-05-08',
  },
  {
    project: 'Mini-SWE-Agent',
    status: 'official',
    repos: [{ slug: 'SWE-agent/mini-swe-agent' }],
    tags: ['swe-bench', 'lightweight-agent'],
    note: 'Official lightweight software-engineering agent repository.',
    lastSeen: '2026-05-21',
  },
  {
    project: 'little-coder',
    status: 'official',
    repos: [{ slug: 'itayinbarr/little-coder' }],
    tags: ['typescript', 'local-models', 'coding-agent'],
    note: 'Coding agent optimized for smaller local models.',
    lastSeen: '2026-05-23',
  },
  {
    project: 'Harness Agent',
    status: 'official',
    repos: [{ slug: 'lazyFrogLOL/Harness_Engineering' }],
    tags: ['terminal-bench', 'harness'],
    note: 'Public Harness_Engineering repo reports the Terminal-Bench result for Harness Agent.',
  },
  {
    project: 'vix',
    status: 'related',
    repos: [{ slug: 'kirby88/vix-releases' }],
    tags: ['release-repo', 'terminal-bench'],
    note: 'Public release repository only; full source was not verified in the report.',
    leaderboard: [{ rank: 1, scorePct: 90.2, model: 'Claude Opus 4.7', date: '2026-05-15', source: LEADERBOARD_SOURCE, note: 'release repository only; skipped for source-pattern mining' }],
  },
  {
    project: 'Meta-Harness',
    status: 'related',
    repos: [{ slug: 'stanford-iris-lab/meta-harness-tbench2-artifact' }],
    tags: ['artifact', 'terminal-bench', 'research'],
    note: 'Official Stanford IRIS artifact repo, not clearly the full product source.',
    lastSeen: '2026-03-26',
    leaderboard: [{ rank: 13, scorePct: 76.4, model: 'Claude Opus 4.6', date: '2026-05-14', source: LEADERBOARD_SOURCE }],
  },
  {
    project: 'Simple Codex',
    status: 'related',
    repos: [{ slug: 'openai/codex' }],
    tags: ['openai', 'codex', 'indirect'],
    note: 'Indirect mapping: benchmark entry points to Codex product page; public source is broader Codex CLI.',
    lastSeen: '2026-05-27',
    leaderboard: [{ rank: 17, scorePct: 75.1, model: 'GPT-5.3-Codex', date: '2026-02-06', source: LEADERBOARD_SOURCE }],
  },
  {
    project: 'CAMEL-AI',
    status: 'related',
    repos: [
      { slug: 'camel-ai/seta', role: 'terminal-agent project' },
      { slug: 'camel-ai/camel', role: 'broader agent framework' },
    ],
    tags: ['terminal-agent', 'framework', 'indirect'],
    note: 'Relevant terminal-agent work is SETA under CAMEL-AI; mapping is organization-level and indirect.',
    lastSeen: '2026-02-16',
  },
  {
    project: 'JJAgent',
    status: 'unverified',
    repos: [],
    tags: ['github-profile-only', 'terminal-bench', 'gap'],
    note: 'Official metadata points to a GitHub profile, not a verified implementation repository.',
    leaderboard: [{ rank: 2, scorePct: 87.1, model: 'Multiple', date: '2026-05-15', source: LEADERBOARD_SOURCE }],
  },
  {
    project: 'Capy',
    status: 'unverified',
    repos: [],
    tags: ['website-only', 'terminal-bench', 'gap'],
    note: 'Official Capy site was found, but no public source repository was verified in the report.',
    leaderboard: [
      { rank: 5, scorePct: 83.1, model: 'GPT-5.5', date: '2026-05-14', source: LEADERBOARD_SOURCE },
      { rank: 16, scorePct: 75.3, model: 'Claude Opus 4.6', date: '2026-03-12', source: LEADERBOARD_SOURCE },
    ],
  },
  {
    project: 'Polaris',
    status: 'unverified',
    repos: [],
    tags: ['website-only', 'terminal-bench', 'gap'],
    note: 'Official PolarisOps site was found, but no public source repository was verified in the report.',
    leaderboard: [{ rank: 7, scorePct: 82.2, model: 'Multiple', date: '2026-05-14', source: LEADERBOARD_SOURCE }],
  },
  {
    project: 'TongAgents',
    status: 'unverified',
    repos: [],
    tags: ['website-only', 'terminal-bench', 'gap'],
    note: 'Official BIGAI site was found, but no public source repository was verified in the report.',
    leaderboard: [{ rank: 8, scorePct: 80.2, model: 'Gemini 3.1 Pro', date: '2026-03-13', source: LEADERBOARD_SOURCE }],
  },
  {
    project: 'SageAgent',
    status: 'unverified',
    repos: [],
    tags: ['github-org-only', 'opensage-agent', 'terminal-bench', 'gap'],
    note: 'Official metadata points to a GitHub organization, not a verified implementation repository.',
    leaderboard: [{ rank: 11, scorePct: 78.4, model: 'GPT-5.3-Codex', date: '2026-03-13', source: LEADERBOARD_SOURCE }],
  },
  {
    project: 'Droid',
    status: 'unverified',
    repos: [],
    tags: ['website-only', 'factory-ai', 'terminal-bench', 'gap'],
    note: 'Official Factory AI site was found, but no public source repository was verified in the report.',
    leaderboard: [{ rank: 12, scorePct: 77.3, model: 'GPT-5.3-Codex', date: '2026-02-24', source: LEADERBOARD_SOURCE }],
  },
  {
    project: 'CodeBrain-1.5',
    status: 'unverified',
    repos: [],
    tags: ['website-only', 'terminal-bench', 'gap'],
    note: 'Official Feeling AI site was found, but no public source repository was verified in the report.',
    leaderboard: [{ rank: 14, scorePct: 75.8, model: 'GPT-5.3-Codex', date: '2026-02-10', source: LEADERBOARD_SOURCE }],
  },
  {
    project: 'Terminus-KIRA',
    status: 'unverified',
    repos: [],
    tags: ['website-only', 'krafton-ai', 'terminal-bench', 'gap'],
    note: 'Official KRAFTON AI site was found, but no public source repository was verified in the report.',
    leaderboard: [
      { rank: 18, scorePct: 74.8, model: 'Gemini 3.1 Pro', date: '2026-02-23', source: LEADERBOARD_SOURCE },
      { rank: 19, scorePct: 74.7, model: 'Claude Opus 4.6', date: '2026-02-22', source: LEADERBOARD_SOURCE },
    ],
  },
  {
    project: 'MAYA-V2',
    status: 'unverified',
    repos: [],
    tags: ['website-only', 'adya', 'terminal-bench', 'gap'],
    note: 'Official ADYA MAYA page was found, but no public source repository was verified in the report.',
  },
  {
    project: 'spoox-o-m',
    status: 'unverified',
    repos: [],
    tags: ['hugging-face-trace-only', 'terminal-bench', 'gap'],
    note: 'Public leaderboard and Hugging Face traces exist, but no public source repository was verified.',
  },
  {
    project: 'Junie CLI',
    status: 'unverified',
    repos: [],
    tags: ['website-only', 'jetbrains', 'terminal-bench', 'gap'],
    note: 'Official JetBrains Junie CLI page was found, but no public source repository was verified in the report.',
  },
  {
    project: 'Ante',
    status: 'unverified',
    repos: [],
    tags: ['website-only', 'antigma', 'terminal-bench', 'gap'],
    note: 'Official Antigma Labs site was found, but no public source repository was verified in the report.',
  },
  {
    project: 'IndusAGI Coding Agent',
    status: 'unverified',
    repos: [],
    tags: ['website-only', 'terminal-bench', 'gap'],
    note: 'Official IndusAGI site was found, but no public source repository was verified in the report.',
  },
  {
    project: 'Terminus 2',
    status: 'unverified',
    repos: [],
    tags: ['website-only', 'terminal-bench', 'gap'],
    note: 'Official Terminal-Bench Terminus product page was found, but no separate public source repository was verified.',
  },
  {
    project: 'hookele',
    status: 'unverified',
    repos: [],
    tags: ['technical-writeup-only', 'terminal-bench', 'gap'],
    note: 'Public technical write-up and Hugging Face submission traces exist, but no repository was verified.',
  },
  {
    project: 'Simplai Agent',
    status: 'unverified',
    repos: [],
    tags: ['website-only', 'terminal-bench', 'gap'],
    note: 'Official SimplAI site was found, but no public source repository was verified in the report.',
  },
  {
    project: 'Dakou Agent',
    status: 'unverified',
    repos: [],
    tags: ['product-docs-only', 'iflow', 'terminal-bench', 'gap'],
    note: 'Public iflow product documentation exists, but no public source repository was verified.',
  },
  {
    project: 'Bash Agent',
    status: 'unverified',
    repos: [],
    tags: ['model-card-only', 'hugging-face', 'terminal-bench', 'gap'],
    note: 'Official metadata points to a Hugging Face model card, not a verified agent-source repository.',
  },
];

export function formatBenchmarkRepoCatalog(input: Record<string, unknown> = {}): string {
  const normalized = normalizeBenchmarkRepoCatalogInput(input);
  if (normalized.topOpenSource) {
    return formatTopOpenSourceBenchmarkRepos(normalized);
  }

  const allMatches = filterBenchmarkRepoCatalog(normalized);
  const matches = allMatches.slice(0, normalized.limit);
  const officialCount = TERMINAL_BENCH_REPO_CATALOG.filter((entry) => entry.status === 'official').length;
  const relatedCount = TERMINAL_BENCH_REPO_CATALOG.filter((entry) => entry.status === 'related').length;
  const unverifiedCount = TERMINAL_BENCH_REPO_CATALOG.filter((entry) => entry.status === 'unverified').length;

  if (normalized.reposOnly) {
    return uniqueStrings(matches.flatMap((entry) => entry.repos.map((repo) => repo.slug))).join('\n');
  }

  const lines = [
    '# Terminal-Bench Public Repo Catalog',
    `Source: ${CATALOG_SOURCE}.`,
    `Coverage seed: ${officialCount} official/direct project mappings, ${relatedCount} related or partial mappings, ${unverifiedCount} no-public-source gaps.`,
    'Caveat: this is a packaged source-mining seed, not live leaderboard truth; verify positive hits with /repo-digest before porting patterns and do not overclaim unverified gaps.',
    '',
    `Filters: status=${normalized.status}, query=${normalized.query ? JSON.stringify(normalized.query) : '(none)'}, limit=${normalized.limit}`,
    `Matches: ${allMatches.length}${allMatches.length > matches.length ? ` (showing ${matches.length})` : ''}`,
    '',
  ];

  if (matches.length === 0) {
    lines.push('No matching public repo mappings found.');
    lines.push('Try: /benchmark-repos --all');
    return lines.join('\n');
  }

  for (const entry of matches) {
    const repoText = entry.repos
      .map((repo) => repo.role ? `${repo.slug} (${repo.role})` : repo.slug)
      .join(' | ') || '(none verified)';
    const seen = entry.lastSeen ? `; last_seen=${entry.lastSeen}` : '';
    lines.push(`- ${entry.project} [${entry.status}${seen}]`);
    const leaderboard = formatBestLeaderboardSnapshot(entry);
    if (leaderboard) lines.push(`  leaderboard: ${leaderboard}`);
    lines.push(`  repos: ${repoText}`);
    lines.push(`  tags: ${entry.tags.join(', ')}`);
    lines.push(`  note: ${entry.note}`);
  }

  lines.push('');
  lines.push('Next step: run /repo-digest <owner/repo> --files 500 --text-files 6 on the most relevant repo, then verify exact files locally.');
  return lines.join('\n');
}

export interface BenchmarkTopOpenSourceSelection {
  project: string;
  status: BenchmarkRepoStatus;
  repo: BenchmarkRepoRef;
  leaderboard: BenchmarkLeaderboardSnapshot;
  note: string;
  docsOnly: boolean;
}

export function selectTopOpenSourceBenchmarkRepos(input: {
  leaderboardTop?: number;
  limit?: number;
  includeRelated?: boolean;
  docsOnly?: boolean;
} = {}): BenchmarkTopOpenSourceSelection[] {
  const leaderboardTop = clampPositiveInteger(input.leaderboardTop, 20, 1, 200);
  const limit = clampPositiveInteger(input.limit, 10, 1, 50);
  const includeRelated = input.includeRelated !== false;
  const docsOnly = input.docsOnly !== false;
  const seen = new Set<string>();
  const selected: BenchmarkTopOpenSourceSelection[] = [];

  for (const entry of rankedLeaderboardEntries(leaderboardTop)) {
    if (entry.status === 'unverified') continue;
    if (entry.status === 'related' && !includeRelated) continue;
    if (entry.tags.includes('release-repo')) continue;
    const leaderboard = bestLeaderboardSnapshot(entry);
    if (!leaderboard) continue;
    for (const repo of entry.repos) {
      const slugKey = repo.slug.toLowerCase();
      if (seen.has(slugKey)) continue;
      seen.add(slugKey);
      selected.push({
        project: entry.project,
        status: entry.status,
        repo,
        leaderboard,
        note: entry.note,
        docsOnly,
      });
      if (selected.length >= limit) return selected;
    }
  }

  return selected;
}

export function filterBenchmarkRepoCatalog(input: {
  query?: string;
  status: 'official' | 'related' | 'unverified' | 'all';
}): BenchmarkRepoEntry[] {
  const query = input.query?.trim().toLowerCase();
  return TERMINAL_BENCH_REPO_CATALOG.filter((entry) => {
    if (input.status !== 'all' && entry.status !== input.status) return false;
    if (!query) return true;
    const haystack = [
      entry.project,
      entry.status,
      entry.note,
      ...entry.tags,
      ...entry.repos.flatMap((repo) => [repo.slug, repo.role ?? '']),
    ].join('\n').toLowerCase();
    return haystack.includes(query);
  });
}

export function parseBenchmarkRepoCatalogCommandArgs(args: string): BenchmarkRepoCatalogParseResult {
  const tokens = tokenizeArgs(args);
  const input: Record<string, unknown> = {
    status: 'official',
    limit: 12,
  };
  const queryParts: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.startsWith('-')) {
      queryParts.push(token);
      continue;
    }

    if (token === '--all') {
      input.status = 'all';
      input.limit = input.limit === 12 ? 50 : input.limit;
      continue;
    }
    if (token === '--official') {
      input.status = 'official';
      continue;
    }
    if (token === '--related' || token === '--partial') {
      input.status = 'related';
      continue;
    }
    if (token === '--unverified' || token === '--no-source' || token === '--missing') {
      input.status = 'unverified';
      continue;
    }
    if (token === '--repos-only' || token === '--slugs') {
      input.repos_only = true;
      continue;
    }
    if (token === '--digest' || token === '--repo-digest') {
      input.digest = true;
      continue;
    }
    if (token === '--top-open-source' || token === '--top-source' || token === '--top-repos') {
      input.top_open_source = true;
      input.status = 'all';
      input.limit = input.limit === 12 ? 10 : input.limit;
      input.docs_only = input.docs_only ?? true;
      continue;
    }
    if (token === '--docs-only' || token === '--no-source-code') {
      input.docs_only = true;
      continue;
    }
    if (token === '--source-code') {
      input.docs_only = false;
      continue;
    }
    if (token === '--official-only') {
      input.include_related = false;
      continue;
    }
    if (token === '--include-related') {
      input.include_related = true;
      continue;
    }

    const { name, inlineValue } = splitFlag(token);
    if (!['--status', '--kind', '--limit', '-n', '--leaderboard-top', '--from-top'].includes(name)) {
      return { error: `unknown option "${name}"` };
    }
    const value = inlineValue ?? tokens[i + 1];
    if (!value || value.startsWith('-')) return { error: `${name} requires a value` };
    if (inlineValue == null) i++;

    switch (name) {
      case '--status':
      case '--kind': {
        const normalized = value.toLowerCase();
        if (!['official', 'related', 'partial', 'unverified', 'no-source', 'no_source', 'missing', 'all'].includes(normalized)) {
          return { error: `unsupported status "${value}"` };
        }
        input.status = normalizeStatusAlias(normalized);
        break;
      }
      case '--limit':
      case '-n': {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return { error: `limit must be a positive number, got "${value}"` };
        input.limit = Math.floor(n);
        break;
      }
      case '--leaderboard-top':
      case '--from-top': {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return { error: `leaderboard_top must be a positive number, got "${value}"` };
        input.leaderboard_top = Math.floor(n);
        break;
      }
    }
  }

  const query = queryParts.join(' ').trim();
  if (query) input.query = query;
  return { input };
}

export function formatBenchmarkRepoCatalogUsage(): string {
  return [
    '  Usage: /benchmark-repos [query] [--all|--official|--related|--unverified] [--limit n] [--repos-only] [--digest]',
    '         /benchmark-repos --top-open-source [--from-top n] [--limit n] [--docs-only|--source-code]',
    '  Defaults: --official --limit 12',
    '  Examples:',
    '    /benchmark-repos --top-open-source --from-top 20 --limit 10',
    '    /benchmark-repos openhands --all',
    '    /benchmark-repos nexau --all --digest',
    '    /benchmark-repos --unverified --limit 20',
    '    /benchmark-repos terminal-agent --all --repos-only',
  ].join('\n');
}

export function encodeBenchmarkReposSentinel(input: Record<string, unknown>): string {
  return `__BENCHMARK_REPOS__${JSON.stringify(input)}`;
}

export function decodeBenchmarkReposSentinel(value: string): Record<string, unknown> | null {
  if (!value.startsWith('__BENCHMARK_REPOS__')) return null;
  try {
    const parsed = JSON.parse(value.slice('__BENCHMARK_REPOS__'.length));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export const BenchmarkRepoCatalogTool: Tool = {
  name: 'benchmark_repo_catalog',
  description:
    'List a packaged Terminal-Bench 2.0 public-repository source-mining catalog. Use before github_repo_digest when looking for public agent or leaderboard implementation examples; verify exact files before porting patterns.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Optional filter over project name, repo slug, tags, and notes.',
      },
      status: {
        type: 'string',
        enum: ['official', 'related', 'unverified', 'all'],
        description: 'Catalog subset to show. Defaults to official/direct mappings. Use unverified for known no-public-source gaps.',
      },
      limit: {
        type: 'number',
        description: 'Maximum project entries to return. Default 12, max 50.',
      },
      repos_only: {
        type: 'boolean',
        description: 'If true, return only owner/repo slugs, one per line.',
      },
      top_open_source: {
        type: 'boolean',
        description: 'If true, select verified public repo targets from the highest-ranked leaderboard entries instead of doing a text filter.',
      },
      leaderboard_top: {
        type: 'number',
        description: 'When top_open_source is true, only consider entries with rank <= this value. Default 20.',
      },
      include_related: {
        type: 'boolean',
        description: 'When top_open_source is true, include related/partial public artifacts in addition to official source mappings. Default true.',
      },
      docs_only: {
        type: 'boolean',
        description: 'Mark returned top-open-source targets as docs/metadata-only mining targets so source-code excerpts are skipped downstream.',
      },
    },
    additionalProperties: false,
  },
  isReadOnly: true,
  isDestructive: false,
  async call(input): Promise<ToolResult> {
    return { output: formatBenchmarkRepoCatalog(input), isError: false };
  },
};

export function selectBenchmarkRepoDigestTarget(input: Record<string, unknown>): string | null {
  const normalized = normalizeBenchmarkRepoCatalogInput(input);
  const matches = filterBenchmarkRepoCatalog(normalized);
  for (const entry of matches) {
    const repo = entry.repos[0]?.slug;
    if (repo) return repo;
  }
  return null;
}

function normalizeBenchmarkRepoCatalogInput(input: Record<string, unknown>): {
  query?: string;
  status: 'official' | 'related' | 'unverified' | 'all';
  limit: number;
  reposOnly: boolean;
  topOpenSource: boolean;
  leaderboardTop: number;
  includeRelated: boolean;
  docsOnly: boolean;
} {
  const rawStatus = String(input.status || 'official').toLowerCase();
  const status = normalizeStatusAlias(rawStatus);
  const topOpenSource = input.top_open_source === true;
  const defaultLimit = topOpenSource ? 10 : 12;
  const limit = clampPositiveInteger(input.limit, defaultLimit, 1, 50);
  const query = typeof input.query === 'string' && input.query.trim() ? input.query.trim() : undefined;
  const reposOnly = input.repos_only === true;
  const leaderboardTop = clampPositiveInteger(input.leaderboard_top, 20, 1, 200);
  const includeRelated = input.include_related !== false;
  const docsOnly = input.docs_only === true || topOpenSource;
  return { query, status, limit, reposOnly, topOpenSource, leaderboardTop, includeRelated, docsOnly };
}

function normalizeStatusAlias(value: string): 'official' | 'related' | 'unverified' | 'all' {
  if (value === 'all') return 'all';
  if (value === 'related' || value === 'partial') return 'related';
  if (value === 'unverified' || value === 'no-source' || value === 'no_source' || value === 'missing') {
    return 'unverified';
  }
  return 'official';
}

function splitFlag(token: string): { name: string; inlineValue?: string } {
  const idx = token.indexOf('=');
  if (idx === -1) return { name: token };
  return { name: token.slice(0, idx), inlineValue: token.slice(idx + 1) };
}

function tokenizeArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const ch of input) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === '\\') {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }

  if (escaping) current += '\\';
  if (current) tokens.push(current);
  return tokens;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function formatTopOpenSourceBenchmarkRepos(input: {
  limit: number;
  reposOnly: boolean;
  leaderboardTop: number;
  includeRelated: boolean;
  docsOnly: boolean;
}): string {
  const selected = selectTopOpenSourceBenchmarkRepos({
    leaderboardTop: input.leaderboardTop,
    limit: input.limit,
    includeRelated: input.includeRelated,
    docsOnly: input.docsOnly,
  });

  if (input.reposOnly) {
    return selected.map((item) => item.repo.slug).join('\n');
  }

  const skipped = topLeaderboardSkipNotes(input.leaderboardTop, input.includeRelated);
  const lines = [
    '# Terminal-Bench Top Open-Source Repo Targets',
    `Leaderboard source: ${LEADERBOARD_SOURCE}.`,
    `Catalog source: ${CATALOG_SOURCE}.`,
    `Selection: top ${input.leaderboardTop} leaderboard entries, repo_limit=${input.limit}, include_related=${input.includeRelated ? 'yes' : 'no'}, docs_only=${input.docsOnly ? 'yes' : 'no'}.`,
    `Verified repo targets: ${selected.length}${selected.length < input.limit ? ` (fewer than ${input.limit}; top ${input.leaderboardTop} contains duplicates, release-only repos, and no-public-source gaps)` : ''}.`,
    '',
  ];

  if (input.docsOnly) {
    lines.push('Source-code guard: inspect READMEs, docs, manifests, trees, and public metadata first; avoid copying or mining implementation source unless explicitly requested.');
    lines.push('');
  }

  for (const item of selected) {
    const role = item.repo.role ? ` (${item.repo.role})` : '';
    lines.push(`- #${item.leaderboard.rank} ${item.project} -> ${item.repo.slug}${role}`);
    lines.push(`  leaderboard: ${item.leaderboard.scorePct.toFixed(1)}% with ${item.leaderboard.model} on ${item.leaderboard.date}`);
    lines.push(`  status: ${item.status}`);
    lines.push(`  note: ${item.note}`);
    lines.push(`  next: /repo-digest ${item.repo.slug} --files 500 ${input.docsOnly ? '--docs-only' : '--text-files 6'}`);
  }

  if (skipped.length > 0) {
    lines.push('');
    lines.push(`Skipped top-${input.leaderboardTop} entries without a verified reusable public source target:`);
    for (const note of skipped) lines.push(`- ${note}`);
  }

  return lines.join('\n');
}

function rankedLeaderboardEntries(leaderboardTop: number): BenchmarkRepoEntry[] {
  return TERMINAL_BENCH_REPO_CATALOG
    .filter((entry) => {
      const best = bestLeaderboardSnapshot(entry);
      return best && best.rank <= leaderboardTop;
    })
    .sort((a, b) => bestLeaderboardSnapshot(a)!.rank - bestLeaderboardSnapshot(b)!.rank);
}

function topLeaderboardSkipNotes(leaderboardTop: number, includeRelated: boolean): string[] {
  return rankedLeaderboardEntries(leaderboardTop)
    .filter((entry) => {
      if (entry.status === 'unverified') return true;
      if (entry.status === 'related' && !includeRelated) return true;
      if (entry.tags.includes('release-repo')) return true;
      return entry.repos.length === 0;
    })
    .map((entry) => {
      const best = bestLeaderboardSnapshot(entry)!;
      const reason = entry.tags.includes('release-repo')
        ? 'release-only repository'
        : entry.status === 'unverified'
          ? 'no verified public implementation repository'
          : entry.status === 'related' && !includeRelated
            ? 'related/partial mapping excluded by --official-only'
            : 'no repository slug';
      return `#${best.rank} ${entry.project}: ${reason}`;
    });
}

function bestLeaderboardSnapshot(entry: BenchmarkRepoEntry): BenchmarkLeaderboardSnapshot | null {
  const snapshots = entry.leaderboard ?? [];
  if (snapshots.length === 0) return null;
  return [...snapshots].sort((a, b) => a.rank - b.rank)[0] ?? null;
}

function formatBestLeaderboardSnapshot(entry: BenchmarkRepoEntry): string | null {
  const best = bestLeaderboardSnapshot(entry);
  if (!best) return null;
  return `#${best.rank} ${best.scorePct.toFixed(1)}% ${best.model} ${best.date}`;
}

function clampPositiveInteger(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export const _internal = {
  tokenizeArgs,
  normalizeBenchmarkRepoCatalogInput,
  normalizeStatusAlias,
  bestLeaderboardSnapshot,
  CATALOG_SOURCE,
  LEADERBOARD_SOURCE,
};

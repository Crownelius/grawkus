/**
 * github_repo_digest: bounded source-code observability for public GitHub repos.
 *
 * This complements research_sources: /sources finds current repo links, and this
 * tool turns one repo into a compact component/manifests/command digest without
 * cloning or sending a model call.
 */
import type { Tool, ToolResult } from './types.js';

interface ParsedRepo {
  owner: string;
  repo: string;
}

interface GitHubRepoMeta {
  full_name?: string;
  html_url?: string;
  description?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  language?: string | null;
  pushed_at?: string;
  updated_at?: string;
  default_branch?: string;
  archived?: boolean;
  visibility?: string;
  license?: { spdx_id?: string | null; name?: string | null } | null;
  topics?: string[];
}

interface GitHubTreeItem {
  path?: string;
  type?: string;
  size?: number;
}

interface GitHubTree {
  tree?: GitHubTreeItem[];
  truncated?: boolean;
}

interface KeyFile {
  path: string;
  text: string;
}

type HarnessSurfaceId =
  | 'prompts'
  | 'tools'
  | 'middleware'
  | 'skills_agents'
  | 'memory'
  | 'benchmarks_evals'
  | 'providers_models'
  | 'docs';

const USER_AGENT = 'grawkus/1.x (+https://github.com/Crownelius/grawkus)';
const GITHUB_API = 'https://api.github.com';

const MANIFEST_NAMES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'bun.lock',
  'bun.lockb',
  'pyproject.toml',
  'uv.lock',
  'requirements.txt',
  'requirements-dev.txt',
  'setup.py',
  'setup.cfg',
  'Cargo.toml',
  'Cargo.lock',
  'go.mod',
  'go.sum',
  'Makefile',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'pom.xml',
  'mvnw',
  'mvnw.cmd',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'gradlew',
  'gradlew.bat',
  'deno.json',
]);

const KEY_FILE_CANDIDATES = [
  'README.md',
  'README.rst',
  'README.txt',
  'docs/README.md',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'requirements.txt',
  'Dockerfile',
  'Makefile',
  'src/index.ts',
  'src/main.ts',
  'src/main.py',
  'src/agent.py',
  'agent.py',
];

const DOCS_ONLY_KEY_FILE_CANDIDATES = [
  'README.md',
  'README.rst',
  'README.txt',
  'docs/README.md',
  'docs/index.md',
  'docs/quickstart.md',
  'docs/getting-started.md',
  'docs/usage.md',
  'docs/architecture.md',
  'docs/design.md',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'requirements.txt',
  'Dockerfile',
  'Makefile',
];

const SURFACE_PATTERNS: Array<{ id: HarnessSurfaceId; label: string; re: RegExp }> = [
  { id: 'prompts', label: 'prompts', re: /(^|\/)(prompts?|system[-_ ]?prompt|instructions?|rules?)(\/|\.|-|_|$)/i },
  { id: 'tools', label: 'tools', re: /(^|\/)(tools?|commands?|actions?|functions?)(\/|\.|-|_|$)/i },
  { id: 'middleware', label: 'middleware', re: /(^|\/)(middleware|runtime|controller|policy|sandbox|permission|queue|stream|loop)(\/|\.|-|_|$)/i },
  { id: 'skills_agents', label: 'skills/agents', re: /(^|\/)(skills?|agents?|subagents?|patterns?)(\/|\.|-|_|$)/i },
  { id: 'memory', label: 'memory', re: /(^|\/)(memory|memories|mempalace|vector|retrieval|retriever|rag)(\/|\.|-|_|$)/i },
  { id: 'benchmarks_evals', label: 'benchmarks/evals', re: /(^|\/)(bench|benchmark|eval|evaluation|tests?|verifier|harness|terminal-bench|swe-bench)(\/|\.|-|_|$)/i },
  { id: 'providers_models', label: 'providers/models', re: /(^|\/)(providers?|models?|llm|openai|anthropic|openrouter|gemini|ollama)(\/|\.|-|_|$)/i },
  { id: 'docs', label: 'docs', re: /(^|\/)(docs?|readme|examples?)(\/|\.|-|_|$)/i },
];

const EXT_LABELS: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.rs': 'Rust',
  '.go': 'Go',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.cs': 'C#',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.cxx': 'C++',
  '.c': 'C',
  '.h': 'C/C++ header',
  '.hpp': 'C++ header',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.swift': 'Swift',
  '.md': 'Markdown',
  '.rst': 'reStructuredText',
  '.yml': 'YAML',
  '.yaml': 'YAML',
  '.json': 'JSON',
  '.toml': 'TOML',
};

export const GitHubRepoDigestTool: Tool = {
  name: 'github_repo_digest',
  description:
    'Inspect a public GitHub repository without cloning it. Returns bounded metadata, file tree signals, manifests, likely commands, key excerpts, and AHE-style component surface counts for source-grounded agent/leaderboard research.',
  parameters: {
    type: 'object',
    properties: {
      repo: {
        type: 'string',
        description: 'GitHub repository as owner/repo, a github.com URL, or a git@github.com URL.',
      },
      ref: {
        type: 'string',
        description: 'Optional branch, tag, or commit SHA. Defaults to the repository default branch.',
      },
      max_files: {
        type: 'number',
        description: 'Maximum tree paths to analyze. Default 300, max 2000.',
      },
      max_text_files: {
        type: 'number',
        description: 'Maximum key text files to fetch for excerpts. Default 5, max 12.',
      },
      max_excerpt_chars: {
        type: 'number',
        description: 'Maximum characters to keep per key file excerpt. Default 1200, max 4000.',
      },
      docs_only: {
        type: 'boolean',
        description: 'If true, fetch only docs and manifest excerpts, skipping source-code key files.',
      },
    },
    required: ['repo'],
    additionalProperties: false,
  },
  isReadOnly: true,
  isDestructive: false,

  async call(input): Promise<ToolResult> {
    return buildGitHubRepoDigest(input);
  },
};

export async function buildGitHubRepoDigest(input: Record<string, unknown>): Promise<ToolResult> {
  const raw = String(input.repo || '').trim();
  const parsed = parseGitHubRepo(raw);
  if (!parsed) {
    return {
      output: 'github_repo_digest: provide a GitHub repository as owner/repo or https://github.com/owner/repo',
      isError: true,
    };
  }

  const maxFiles = clampNumber(input.max_files, 300, 20, 2000);
  const maxTextFiles = clampNumber(input.max_text_files, 5, 0, 12);
  const maxExcerptChars = clampNumber(input.max_excerpt_chars, 1200, 200, 4000);
  const docsOnly = input.docs_only === true;

  try {
    const meta = await fetchJson<GitHubRepoMeta>(`${GITHUB_API}/repos/${parsed.owner}/${parsed.repo}`);
    const ref = String(input.ref || meta.default_branch || 'main').trim();
    const tree = await fetchRepoTree(parsed, ref);
    const allPaths = (tree.tree ?? [])
      .filter((item) => item.type === 'blob' && item.path)
      .map((item) => normalizePath(item.path!))
      .sort((a, b) => a.localeCompare(b));
    const paths = selectAnalysisPaths(allPaths, maxFiles);
    const selectedKeyFiles = selectKeyFiles(allPaths, maxTextFiles, docsOnly);
    const keyFiles = await fetchKeyFiles(parsed, ref, selectedKeyFiles, maxExcerptChars);

    return {
      output: formatRepoDigest({
        repo: parsed,
        meta,
        ref,
        paths,
        totalPaths: allPaths.length,
        treeTruncated: tree.truncated === true || allPaths.length > paths.length,
        keyFiles,
        keyFileErrors: selectedKeyFiles.filter((path) => !keyFiles.some((file) => file.path === path)),
        docsOnly,
      }),
      isError: false,
    };
  } catch (err) {
    return {
      output: `github_repo_digest: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}

export function parseGitHubRepo(value: string): ParsedRepo | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const ssh = trimmed.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (ssh) return normalizeRepoParts(ssh[1], ssh[2]);

  let candidate = trimmed
    .replace(/^git\+/i, '')
    .replace(/\.git$/i, '')
    .replace(/^https?:\/\/api\.github\.com\/repos\//i, '')
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^github\.com\//i, '');
  candidate = candidate.split(/[?#]/, 1)[0].replace(/^\/+|\/+$/g, '');
  const parts = candidate.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return normalizeRepoParts(parts[0], parts[1]);
}

function normalizeRepoParts(owner: string, repo: string): ParsedRepo | null {
  const cleanOwner = owner.trim();
  const cleanRepo = repo.trim().replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]+$/.test(cleanOwner) || !/^[A-Za-z0-9_.-]+$/.test(cleanRepo)) return null;
  return { owner: cleanOwner, repo: cleanRepo };
}

async function fetchRepoTree(repo: ParsedRepo, ref: string): Promise<GitHubTree> {
  const safeRef = encodeURIComponent(ref);
  return fetchJson<GitHubTree>(`${GITHUB_API}/repos/${repo.owner}/${repo.repo}/git/trees/${safeRef}?recursive=1`);
}

async function fetchJson<T>(url: string): Promise<T> {
  const resp = await fetch(url, {
    headers: githubHeaders(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!resp.ok) {
    throw new Error(`GitHub HTTP ${resp.status} for ${stripGitHubApiUrl(url)}`);
  }
  return await resp.json() as T;
}

async function fetchKeyFiles(
  repo: ParsedRepo,
  ref: string,
  paths: string[],
  maxExcerptChars: number,
): Promise<KeyFile[]> {
  const files: KeyFile[] = [];
  const settled = await Promise.allSettled(paths.map(async (path) => {
    const url = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${encodePath(ref)}/${encodePath(path)}`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(20_000),
    });
    if (!resp.ok) throw new Error(`raw HTTP ${resp.status}`);
    const text = await resp.text();
    return {
      path,
      text: truncate(redactSecrets(text.replace(/\r\n/g, '\n')), maxExcerptChars),
    };
  }));
  for (const result of settled) {
    if (result.status === 'fulfilled') files.push(result.value);
  }
  return files;
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = firstNonEmpty(process.env.GITHUB_TOKEN, process.env.GH_TOKEN, process.env.GITHUB_API_TOKEN);
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function formatRepoDigest(input: {
  repo: ParsedRepo;
  meta: GitHubRepoMeta;
  ref: string;
  paths: string[];
  totalPaths: number;
  treeTruncated: boolean;
  keyFiles: KeyFile[];
  keyFileErrors: string[];
  docsOnly: boolean;
}): string {
  const repoName = input.meta.full_name || `${input.repo.owner}/${input.repo.repo}`;
  const repoUrl = input.meta.html_url || `https://github.com/${input.repo.owner}/${input.repo.repo}`;
  const manifests = input.paths.filter((path) => MANIFEST_NAMES.has(baseName(path))).slice(0, 30);
  const languageLines = summarizeLanguages(input.paths);
  const surfaceLines = summarizeHarnessSurfaces(input.paths);
  const commandLines = summarizeCommands(input.keyFiles);
  const ciFiles = input.paths.filter((path) =>
    /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path) ||
    /(^|\/)(\.gitlab-ci\.yml|circle\.yml|Jenkinsfile|azure-pipelines\.ya?ml)$/i.test(path),
  ).slice(0, 20);

  const lines: string[] = [
    '# GitHub Repo Digest',
    `Repo: ${repoName}`,
    `URL: ${repoUrl}`,
    `Ref: ${input.ref}`,
    '',
    '## Repository Metadata',
    `- description: ${redactSecrets(input.meta.description || '(none)')}`,
    `- primary_language: ${input.meta.language || '(unknown)'}`,
    `- stars: ${formatNumber(input.meta.stargazers_count)}`,
    `- forks: ${formatNumber(input.meta.forks_count)}`,
    `- open_issues: ${formatNumber(input.meta.open_issues_count)}`,
    `- pushed: ${input.meta.pushed_at ? input.meta.pushed_at.slice(0, 10) : '(unknown)'}`,
    `- updated: ${input.meta.updated_at ? input.meta.updated_at.slice(0, 10) : '(unknown)'}`,
    `- default_branch: ${input.meta.default_branch || '(unknown)'}`,
    `- license: ${input.meta.license?.spdx_id || input.meta.license?.name || '(none surfaced)'}`,
    `- archived: ${input.meta.archived === true ? 'yes' : 'no'}`,
    `- topics: ${input.meta.topics?.length ? input.meta.topics.slice(0, 12).join(', ') : '(none)'}`,
    '',
    '## Source Digest',
    `- files_indexed: ${input.paths.length}${input.totalPaths > input.paths.length ? ` of ${input.totalPaths}` : ''}`,
    `- tree_truncated: ${input.treeTruncated ? 'yes' : 'no'}`,
    `- docs_only: ${input.docsOnly ? 'yes' : 'no'}`,
    `- manifests: ${manifests.length ? manifests.join(' | ') : 'none'}`,
    `- ci_files: ${ciFiles.length ? ciFiles.join(' | ') : 'none'}`,
    '',
    '## Language Footprint',
    formatList(languageLines, '(no recognizable source extensions in indexed paths)'),
    '',
    '## Harness Surface Signals',
    formatList(surfaceLines, '(no obvious harness surface signals in indexed paths)'),
    '',
    '## Likely Commands',
    formatList(commandLines, '(no commands found in fetched key files)'),
    '',
    '## Key Excerpts',
  ];

  if (input.keyFiles.length === 0) {
    lines.push('(no key text files fetched)');
  } else {
    for (const file of input.keyFiles) {
      lines.push(`### ${file.path}`);
      lines.push(file.text || '(empty)');
      lines.push('');
    }
  }

  if (input.keyFileErrors.length > 0) {
    lines.push('## Key File Fetch Notes');
    for (const path of input.keyFileErrors.slice(0, 8)) {
      lines.push(`- ${path}: unavailable through raw.githubusercontent.com`);
    }
    lines.push('');
  }

  lines.push(
    '## AHE Fit',
    '- component_observability: use the surface counts above to target prompts, tools, middleware, memory, providers, and benchmark/eval files separately.',
    '- experience_observability: prefer repos with visible benchmarks/evals/tests and CI files when mining reusable agent lessons.',
    input.docsOnly
      ? '- source_code_guard: this digest intentionally skipped source-code excerpts; use docs/manifests for design lessons unless source reading is explicitly approved.'
      : '- decision_observability: treat this digest as orientation only; verify claims by reading the exact files before porting a pattern.',
  );

  return lines.join('\n').trim();
}

function summarizeLanguages(paths: string[]): string[] {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const ext = extensionOf(path);
    if (!ext) continue;
    const label = EXT_LABELS[ext] ?? ext;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([label, count]) => `- ${label}: ${count}`);
}

function summarizeHarnessSurfaces(paths: string[]): string[] {
  const counts = new Map<HarnessSurfaceId, { label: string; count: number; examples: string[] }>();
  for (const pattern of SURFACE_PATTERNS) {
    counts.set(pattern.id, { label: pattern.label, count: 0, examples: [] });
  }

  for (const path of paths) {
    for (const pattern of SURFACE_PATTERNS) {
      if (!pattern.re.test(path)) continue;
      const summary = counts.get(pattern.id)!;
      summary.count++;
      if (summary.examples.length < 4) summary.examples.push(path);
    }
  }

  return Array.from(counts.values())
    .filter((summary) => summary.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map((summary) => `- ${summary.label}: ${summary.count}${summary.examples.length ? ` (${summary.examples.join(' | ')})` : ''}`);
}

function summarizeCommands(files: KeyFile[]): string[] {
  const commands = new Set<string>();
  for (const file of files) {
    if (baseName(file.path) === 'package.json') {
      try {
        const parsed = JSON.parse(file.text) as { scripts?: Record<string, unknown> };
        for (const [name, command] of Object.entries(parsed.scripts ?? {})) {
          if (typeof command === 'string') commands.add(`package script ${name}: ${truncate(redactSecrets(command), 140)}`);
        }
      } catch {
        // Fetched package.json may be truncated; fall through to regex extraction.
      }
    }

    for (const line of file.text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length > 180) continue;
      if (/\b(npm|pnpm|yarn|bun|uv|pip|pytest|python|cargo|go|make|docker|terminal-bench|swe-bench)\b/i.test(trimmed) &&
          /\b(install|test|build|run|eval|evaluate|bench|verify|start|serve|check)\b/i.test(trimmed)) {
        commands.add(`${file.path}: ${truncate(redactSecrets(trimmed.replace(/^[-*#>\s`]+/, '')), 180)}`);
      }
    }
  }
  return Array.from(commands).slice(0, 20).map((command) => `- ${command}`);
}

function selectKeyFiles(paths: string[], maxTextFiles: number, docsOnly = false): string[] {
  if (maxTextFiles <= 0) return [];
  const pathSet = new Set(paths);
  const selected: string[] = [];
  const add = (path: string) => {
    if (selected.length >= maxTextFiles) return;
    if (pathSet.has(path) && !selected.includes(path)) selected.push(path);
  };
  const candidates = docsOnly ? DOCS_ONLY_KEY_FILE_CANDIDATES : KEY_FILE_CANDIDATES;
  for (const candidate of candidates) add(candidate);
  if (selected.length < maxTextFiles) {
    for (const path of paths) {
      if (selected.length >= maxTextFiles) break;
      const docOrManifest = /readme|quickstart|getting[-_ ]?started|usage|architecture|design|agent|harness|benchmark|eval|package\.json|pyproject\.toml|cargo\.toml|go\.mod|requirements\.txt|dockerfile|makefile/i.test(path);
      const allowedExt = docsOnly
        ? /\.(md|rst|txt|json|toml|ya?ml)$/i.test(path) || /(^|\/)(go\.mod|requirements.*\.txt|dockerfile|makefile)$/i.test(path)
        : /\.(md|rst|txt|json|toml|ya?ml|py|ts|js)$/i.test(path);
      if (docOrManifest && allowedExt) {
        add(path);
      }
    }
  }
  return selected;
}

function selectAnalysisPaths(paths: string[], maxFiles: number): string[] {
  if (paths.length <= maxFiles) return paths;
  const pathSet = new Set(paths);
  const selected: string[] = [];
  const add = (path: string) => {
    if (selected.length >= maxFiles) return;
    if (pathSet.has(path) && !selected.includes(path)) selected.push(path);
  };

  for (const candidate of KEY_FILE_CANDIDATES) add(candidate);
  for (const path of paths) {
    if (selected.length >= maxFiles) break;
    if (!path.includes('/') && MANIFEST_NAMES.has(baseName(path))) add(path);
  }
  for (const path of paths) {
    if (selected.length >= maxFiles) break;
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path)) add(path);
  }
  for (const path of paths) {
    if (selected.length >= maxFiles) break;
    add(path);
  }

  return selected;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function baseName(path: string): string {
  return normalizePath(path).split('/').pop() || path;
}

function extensionOf(path: string): string | null {
  const base = baseName(path);
  const idx = base.lastIndexOf('.');
  return idx > 0 ? base.slice(idx).toLowerCase() : null;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function formatList(lines: string[], fallback: string): string {
  return lines.length ? lines.join('\n') : fallback;
}

function formatNumber(value: number | undefined): string {
  return typeof value === 'number' ? value.toLocaleString() : '(unknown)';
}

function truncate(value: string, max: number): string {
  const clean = value.trim();
  return clean.length > max ? clean.slice(0, max - 3).trimEnd() + '...' : clean;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function stripGitHubApiUrl(url: string): string {
  return url.replace(/^https:\/\/api\.github\.com\//, '');
}

function redactSecrets(value: string): string {
  return value
    .replace(/sk-or-v1-[A-Za-z0-9_-]{20,}/g, 'sk-or-v1-[REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, 'sk-[REDACTED]')
    .replace(/hf_[A-Za-z0-9_-]{20,}/g, 'hf_[REDACTED]')
    .replace(/KGAT_[A-Za-z0-9_-]{20,}/g, 'KGAT_[REDACTED]')
    .replace(/npm_[A-Za-z0-9_-]{20,}/g, 'npm_[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?)[^"'\s,}]+/gi, '$1[REDACTED]');
}

export const _internal = {
  parseGitHubRepo,
  selectAnalysisPaths,
  selectKeyFiles,
  summarizeHarnessSurfaces,
  summarizeLanguages,
  summarizeCommands,
  redactSecrets,
};

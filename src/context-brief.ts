import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { globSync } from 'glob';

const IGNORE_GLOBS = [
  '**/.git/**',
  '**/node_modules/**',
  '**/.venv/**',
  '**/venv/**',
  '**/__pycache__/**',
  '**/.pytest_cache/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/target/**',
  '**/.next/**',
  '**/out/**',
];

const MANIFEST_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'pyproject.toml',
  'uv.lock',
  'requirements.txt',
  'Pipfile',
  'Pipfile.lock',
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

export interface ContextBriefOptions {
  maxFiles?: number;
}

export interface ContextDossierOptions extends ContextBriefOptions {
  maxCandidates?: number;
}

interface CandidateFile {
  file: string;
  score: number;
  reasons: string[];
}

const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'against',
  'also',
  'and',
  'are',
  'because',
  'been',
  'before',
  'being',
  'between',
  'but',
  'can',
  'cannot',
  'could',
  'does',
  'doing',
  'each',
  'from',
  'have',
  'into',
  'make',
  'need',
  'needs',
  'not',
  'should',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'this',
  'those',
  'through',
  'when',
  'where',
  'while',
  'with',
  'work',
  'working',
]);

export function buildContextBrief(cwd = process.cwd(), options: ContextBriefOptions = {}): string {
  const root = resolve(cwd);
  if (!existsSync(root)) return `context brief: path does not exist: ${root}`;
  if (!statSync(root).isDirectory()) return `context brief: path is not a directory: ${root}`;

  const maxFiles = clamp(options.maxFiles ?? 300, 50, 1000);
  const allFiles = globSync('**/*', {
    cwd: root,
    nodir: true,
    dot: true,
    maxDepth: 4,
    ignore: IGNORE_GLOBS,
  }).map(normalizePath).sort((a, b) => a.localeCompare(b));
  const files = allFiles.slice(0, maxFiles);
  const manifests = files.filter((file) => MANIFEST_NAMES.has(basename(file)));
  const scripts = readPackageScripts(root);
  const verifiers = inferVerifierCommands(manifests, scripts);
  const rootEntries = listRootEntries(root);
  const languages = summarizeExtensions(files);

  return [
    '# Context Brief',
    `Root: ${root}`,
    `Files scanned: ${files.length}${allFiles.length > files.length ? ` of ${allFiles.length}` : ''}`,
    '',
    '## Git',
    gitSummary(root),
    '',
    '## Root Entries',
    formatList(rootEntries, 24),
    '',
    '## Manifests',
    formatList(manifests, 30),
    '',
    '## Language Footprint',
    formatList(languages, 16),
    '',
    '## Package Scripts',
    formatList(scripts.map((script) => `${script.name}: ${script.command}`), 24),
    '',
    '## Likely Verification Commands',
    formatList(verifiers, 12),
    '',
    '## Suggested First Moves',
    '1. Read the relevant manifest and task/instruction file before editing.',
    '2. Run the narrowest likely verifier before a broad test/build command when feasible.',
    '3. Treat dirty git entries as user work unless this task explicitly owns them.',
  ].join('\n');
}

export function buildContextDossier(task: string, cwd = process.cwd(), options: ContextDossierOptions = {}): string {
  const trimmedTask = task.replace(/\s+/g, ' ').trim();
  if (!trimmedTask) return 'context dossier: missing task. Usage: /context dossier <task>';

  const root = resolve(cwd);
  if (!existsSync(root)) return `context dossier: path does not exist: ${root}`;
  if (!statSync(root).isDirectory()) return `context dossier: path is not a directory: ${root}`;

  const maxFiles = clamp(options.maxFiles ?? 1000, 50, 2000);
  const maxCandidates = clamp(options.maxCandidates ?? 16, 5, 50);
  const allFiles = globSync('**/*', {
    cwd: root,
    nodir: true,
    dot: true,
    maxDepth: 6,
    ignore: IGNORE_GLOBS,
  }).map(normalizePath).sort((a, b) => a.localeCompare(b));
  const files = allFiles.slice(0, maxFiles);
  const manifests = files.filter((file) => MANIFEST_NAMES.has(basename(file)));
  const scripts = readPackageScripts(root);
  const verifiers = inferVerifierCommands(manifests, scripts);
  const tokens = tokenizeTask(trimmedTask);
  const candidates = rankCandidateFiles(files, tokens, trimmedTask).slice(0, maxCandidates);
  const candidateTests = files
    .filter((file) => isTestLike(file))
    .map((file) => scoreCandidate(file, tokens, trimmedTask))
    .filter((candidate) => candidate.score > 0)
    .sort(compareCandidates)
    .slice(0, 10);

  return [
    '# Context Dossier',
    `Task: ${trimmedTask}`,
    `Root: ${root}`,
    `Files scanned: ${files.length}${allFiles.length > files.length ? ` of ${allFiles.length}` : ''}`,
    '',
    '## Candidate Files',
    formatCandidates(candidates),
    '',
    '## Candidate Tests',
    formatCandidates(candidateTests),
    '',
    '## Manifests & Setup Files',
    formatList(manifests, 20),
    '',
    '## Likely Verification Commands',
    formatList(verifiers, 12),
    '',
    '## Dossier Contract',
    '- Read the top candidate files before editing; if none fit, broaden search terms before patching.',
    '- Record candidate files/functions, evidence, reproduction command, and ruled-out distractors before the first non-trivial edit.',
    '- Use /manifest for the planned edit and include Prediction, At-risk regression, Verification, and Rollback criteria.',
    '- Verify narrow first, then broad; when CI hints or package scripts exist, include the relevant CI-like build/test/lint step before finalizing.',
    '- Treat this dossier as a retrieval starting point, not authority; current task files and verifier output override filename matches.',
  ].join('\n');
}

function listRootEntries(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => !['.git', 'node_modules', 'dist', 'build', 'coverage'].includes(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 40)
      .map((entry) => entry.isDirectory() ? `${entry.name}/` : entry.name);
  } catch {
    return [];
  }
}

function readPackageScripts(root: string): Array<{ name: string; command: string }> {
  const path = join(root, 'package.json');
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { scripts?: Record<string, unknown> };
    return Object.entries(parsed.scripts ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([name, command]) => ({ name, command }))
      .slice(0, 30);
  } catch {
    return [];
  }
}

function inferVerifierCommands(
  manifests: string[],
  scripts: Array<{ name: string; command: string }>,
): string[] {
  const names = new Set(manifests.map((file) => basename(file)));
  const commands: string[] = [];
  const add = (command: string) => {
    if (!commands.includes(command)) commands.push(command);
  };

  const scriptNames = new Set(scripts.map((script) => script.name));
  const packageManager = detectPackageManager(names);
  if (names.has('package.json')) {
    for (const name of ['test', 'typecheck', 'lint', 'build']) {
      if (scriptNames.has(name)) add(`${packageManager} run ${name}`);
    }
  }
  if (names.has('pyproject.toml') || names.has('pytest.ini') || Array.from(names).some((name) => /^requirements/.test(name))) {
    add(names.has('uv.lock') ? 'uv run pytest' : 'python -m pytest');
  }
  if (names.has('Cargo.toml')) add('cargo test');
  if (names.has('go.mod')) add('go test ./...');
  if (names.has('pom.xml')) add(names.has('mvnw') ? './mvnw test' : 'mvn test');
  if (Array.from(names).some((name) => /^build\.gradle/.test(name))) {
    add(names.has('gradlew') ? './gradlew test' : 'gradle test');
  }
  return commands;
}

function detectPackageManager(names: Set<string>): string {
  if (names.has('pnpm-lock.yaml')) return 'pnpm';
  if (names.has('yarn.lock')) return 'yarn';
  if (names.has('bun.lock') || names.has('bun.lockb')) return 'bun';
  return 'npm';
}

function summarizeExtensions(files: string[]): string[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const base = basename(file);
    const idx = base.lastIndexOf('.');
    const ext = idx > 0 ? base.slice(idx).toLowerCase() : '(no ext)';
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 16)
    .map(([ext, count]) => `${ext}: ${count}`);
}

function tokenizeTask(task: string): string[] {
  const tokens = task
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
  return Array.from(new Set(tokens)).slice(0, 40);
}

function rankCandidateFiles(files: string[], tokens: string[], task: string): CandidateFile[] {
  return files
    .map((file) => scoreCandidate(file, tokens, task))
    .filter((candidate) => candidate.score > 0 && !MANIFEST_NAMES.has(basename(candidate.file)))
    .sort(compareCandidates);
}

function compareCandidates(a: CandidateFile, b: CandidateFile): number {
  return b.score - a.score || a.file.localeCompare(b.file);
}

function scoreCandidate(file: string, tokens: string[], task: string): CandidateFile {
  const lower = file.toLowerCase();
  const base = basename(lower);
  const reasons: string[] = [];
  let score = 0;

  for (const token of tokens) {
    if (base.includes(token)) {
      score += 6;
      addReason(reasons, `name:${token}`);
    } else if (lower.includes(token)) {
      score += 3;
      addReason(reasons, `path:${token}`);
    }
  }

  for (const rule of TASK_SURFACE_RULES) {
    if (rule.task.test(task) && rule.file.test(file)) {
      score += rule.score;
      addReason(reasons, rule.reason);
    }
  }

  if (isTestLike(file) && /\b(test|spec|verify|regression|failure|failing|ci|build)\b/i.test(task)) {
    score += 4;
    addReason(reasons, 'test surface');
  }
  if (/\b(readme|docs?|guide|manual|usage)\b/i.test(task) && /(^|\/)(readme|docs?|.*\.md$)/i.test(file)) {
    score += 4;
    addReason(reasons, 'docs surface');
  }
  if (/\b(ui|screen|theme|footer|banner|palette|color|colour|input|cursor|prompt)\b/i.test(task) && /\.(tsx?|css|scss|vue|svelte)$/i.test(file)) {
    score += 2;
    addReason(reasons, 'interactive UI surface');
  }

  return { file, score, reasons };
}

const TASK_SURFACE_RULES: Array<{ task: RegExp; file: RegExp; score: number; reason: string }> = [
  {
    task: /\b(slash|command|palette|selector|help|resume|config|wizard)\b/i,
    file: /(^|\/)(index|command-palette|picker|session-picker|config)\.ts$|tests\/.*command/i,
    score: 8,
    reason: 'command/CLI surface',
  },
  {
    task: /\b(prompt|input|cursor|queue|queued|freeze|freezing|turn|heartbeat|footer|stream|streaming|cancel|f5|esc)\b/i,
    file: /(^|\/)(query|live-queue|fixed-footer|prompt-buffer|status|retry|api)\.ts$|tests\/.*(query|liveness|queue|footer|prompt)/i,
    score: 8,
    reason: 'turn liveness surface',
  },
  {
    task: /\b(model|provider|openrouter|openai|oauth|codex|api|rate|fallback)\b/i,
    file: /(^|\/)(api|openai-oauth|openai-smoke|openrouter-models|model-router|config|query)\.ts$|tests\/.*(oauth|provider|openrouter|api|model)/i,
    score: 7,
    reason: 'provider/model surface',
  },
  {
    task: /\b(memory|mempalace|remember|diary|import)\b/i,
    file: /(^|\/)(mempalace|memory|imports)|tests\/.*(memory|import)/i,
    score: 7,
    reason: 'memory surface',
  },
  {
    task: /\b(swarm|agent|orchestrate|multi-agent|handoff|roles?)\b/i,
    file: /(^|\/)(swarm|orchestration|agents|ecc)\.ts$|tests\/.*swarm/i,
    score: 7,
    reason: 'agent orchestration surface',
  },
  {
    task: /\b(benchmark|leaderboard|terminal-bench|swe|ci|harness|trace|ahe|contextbench|eval)\b/i,
    file: /benchmark|harness|evaluation|kbench|terminal_bench|trace|context-brief|ahe-manifest|tests\/.*(benchmark|harness|context|trace)/i,
    score: 7,
    reason: 'benchmark/harness surface',
  },
  {
    task: /\b(source|research|arxiv|github|hugging|kaggle|paper|dataset|competition)\b/i,
    file: /research-sources|source-command|search-first|github-repo-digest|benchmark-repos|tests\/.*(research|source|repo)/i,
    score: 7,
    reason: 'source research surface',
  },
  {
    task: /\b(theme|palette|color|colour|logo|banner|design|accessibility|voice)\b/i,
    file: /(^|\/)(theme|brand|animations|accessibility|voice|fixed-footer)\.ts$|tests\/.*(theme|brand|accessibility|voice|footer)/i,
    score: 6,
    reason: 'UX surface',
  },
];

function isTestLike(file: string): boolean {
  return /(^|\/)(tests?|__tests__)\/|[._-](test|spec)\.[cm]?[jt]sx?$|[._-](test|spec)\.py$/i.test(file);
}

function addReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function formatCandidates(candidates: CandidateFile[]): string {
  if (candidates.length === 0) return '(none found)';
  return candidates
    .map((candidate) => `- ${candidate.file} (score ${candidate.score}; ${candidate.reasons.slice(0, 4).join(', ') || 'matched task surface'})`)
    .join('\n');
}

function gitSummary(root: string): string {
  try {
    const inside = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
    if (inside !== 'true') return 'Not a git worktree.';
    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim() || '(detached)';
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
    const status = execFileSync('git', ['status', '--short'], {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
      maxBuffer: 128 * 1024,
    }).trim();
    const count = status ? status.split(/\r?\n/).length : 0;
    const location = relative(root, top) || '.';
    return `branch: ${branch}\nworktree: ${location}\ndirty entries: ${count}`;
  } catch {
    return 'Git state unavailable.';
  }
}

function formatList(items: string[], limit: number): string {
  if (items.length === 0) return '(none found)';
  const shown = items.slice(0, limit).map((item) => `- ${item}`);
  if (items.length > limit) shown.push(`- ... ${items.length - limit} more`);
  return shown.join('\n');
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

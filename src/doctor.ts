import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { getConfigDir } from './config.js';
import { getOpenAICodexAuthStatus } from './openai-oauth.js';
import { PROVIDERS, type GrawkusConfig, type ProviderPreset } from './types.js';

export type DoctorStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  detail: string;
  hint?: string;
}

export interface DoctorReport {
  version: string;
  generatedAt: string;
  platform: string;
  nodeVersion: string;
  cwd: string;
  configDir: string;
  checks: DoctorCheck[];
  summary: Record<DoctorStatus, number>;
  hasFailures: boolean;
}

export interface DoctorOptions {
  includeRegistry?: boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string; name: string };
const moduleDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(moduleDir, '..');

const SECRET_PATTERNS: RegExp[] = [
  /hf_[A-Za-z0-9]{16,}/g,
  /sk-or-v1-[A-Za-z0-9_-]{20,}/g,
  /npm_[A-Za-z0-9]{16,}/g,
  /KGAT_[A-Za-z0-9]{16,}/g,
  /(?:OPENAI|OPENROUTER|ANTHROPIC|DEEPSEEK|NVIDIA|GOOGLE|GEMINI|GLM|ZHIPUAI|KAGGLE|HF|GITHUB|GH)_[A-Z0-9_]*(?:KEY|TOKEN)=\S+/gi,
];

function redact(value: string): string {
  let out = value;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[redacted]');
  return out;
}

function commandResult(
  command: string,
  args: string[] = [],
  options: { timeoutMs?: number; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): { ok: boolean; status: number | null; stdout: string; stderr: string; error?: string; timedOut: boolean } {
  const useCmdShim = process.platform === 'win32' && command === 'npm';
  const executable = useCmdShim ? process.env.ComSpec || 'cmd.exe' : command;
  const spawnArgs = useCmdShim ? ['/d', '/s', '/c', ['npm', ...args].join(' ')] : args;
  const result = spawnSync(executable, spawnArgs, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 5000,
    windowsHide: true,
  });
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    stdout: redact(String(result.stdout || '').trim()),
    stderr: redact(String(result.stderr || '').trim()),
    error: result.error ? redact(result.error.message) : undefined,
    timedOut: !!result.error && result.error.name === 'ETIMEDOUT',
  };
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
}

function add(checks: DoctorCheck[], check: DoctorCheck): void {
  checks.push(check);
}

function versionAtLeast(current: string, major: number, minor: number, patch: number): boolean {
  const [a = 0, b = 0, c = 0] = current.split('.').map((part) => Number.parseInt(part, 10) || 0);
  if (a !== major) return a > major;
  if (b !== minor) return b > minor;
  return c >= patch;
}

function fileExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function dirWritable(path: string): boolean {
  try {
    if (!existsSync(path)) return false;
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function compactProvider(value: string | undefined): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function providerPreset(provider: string | undefined, baseURL: string | undefined): ProviderPreset | null {
  const compact = compactProvider(provider);
  for (const [key, preset] of Object.entries(PROVIDERS)) {
    if (compact === compactProvider(key) || compact === compactProvider(preset.name)) return preset;
  }
  const base = String(baseURL || '').toLowerCase();
  if (base.includes('openrouter.ai')) return PROVIDERS.openrouter;
  if (base.includes('api.openai.com')) return PROVIDERS.openai;
  if (base.includes('chatgpt.com/backend-api/codex')) return PROVIDERS['openai-codex'];
  if (base.includes('api.deepseek.com')) return PROVIDERS.deepseek;
  if (base.includes('integrate.api.nvidia.com')) return PROVIDERS.nvidia;
  if (base.includes('generativelanguage.googleapis.com')) return PROVIDERS.google;
  if (base.includes('open.bigmodel.cn')) return PROVIDERS.glm;
  if (base.includes('localhost:11434') || base.includes('127.0.0.1:11434')) return PROVIDERS.ollama;
  if (base.includes('localhost:1234') || base.includes('127.0.0.1:1234')) return PROVIDERS.lmstudio;
  return null;
}

function safeHost(url: string | undefined): string {
  if (!url) return '(no base URL)';
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '(invalid base URL)';
  }
}

function envValue(env: NodeJS.ProcessEnv, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

function hasEnv(env: NodeJS.ProcessEnv, ...keys: string[]): boolean {
  return !!envValue(env, ...keys);
}

function resolveDoctorConfigDir(env: NodeJS.ProcessEnv): string {
  return envValue(env, 'GRAWKUS_HOME') || getConfigDir();
}

function configSnapshot(env: NodeJS.ProcessEnv): {
  exists: boolean;
  path: string;
  config: Partial<GrawkusConfig>;
  parseOk: boolean;
} {
  const path = join(resolveDoctorConfigDir(env), 'config.json');
  const exists = fileExists(path);
  const raw = exists ? readJson(path) : null;
  const config: Partial<GrawkusConfig> = raw ? raw as Partial<GrawkusConfig> : {};

  if (envValue(env, 'GRAWKUS_PROVIDER')) {
    config.provider = envValue(env, 'GRAWKUS_PROVIDER')!;
  }
  if (envValue(env, 'GRAWKUS_MODEL_OVERRIDE', 'GRAWKUS_MODEL')) {
    config.model = envValue(env, 'GRAWKUS_MODEL_OVERRIDE', 'GRAWKUS_MODEL')!;
  }
  if (envValue(env, 'GRAWKUS_BASE_URL_OVERRIDE', 'GRAWKUS_BASE_URL', 'OLLAMA_BASE_URL')) {
    config.baseURL = envValue(env, 'GRAWKUS_BASE_URL_OVERRIDE', 'GRAWKUS_BASE_URL', 'OLLAMA_BASE_URL')!;
  }
  if (envValue(env, 'GRAWKUS_API_KEY_OVERRIDE', 'GRAWKUS_API_KEY')) config.apiKey = '__configured__';
  const apiKeyEnv = envValue(env, 'GRAWKUS_API_KEY_ENV');
  if (apiKeyEnv && envValue(env, apiKeyEnv)) config.apiKey = '__configured__';
  if (!config.apiKey && hasEnv(env, 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'NVIDIA_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'GLM_API_KEY', 'ZHIPUAI_API_KEY')) {
    config.apiKey = '__configured__';
  }

  return { exists, path, config, parseOk: !exists || !!raw };
}

function providerRequiresKey(config: Partial<GrawkusConfig>): boolean {
  if (config.openaiAuth?.type === 'codex_oauth') return false;
  const preset = providerPreset(config.provider, config.baseURL);
  if (preset) return preset.requiresKey;
  const base = String(config.baseURL || '').toLowerCase();
  if (base.includes('localhost') || base.includes('127.0.0.1')) return false;
  return true;
}

function hasHuggingFaceAuth(env: NodeJS.ProcessEnv): boolean {
  if (hasEnv(env, 'HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN', 'HUGGINGFACE_TOKEN', 'HUGGINGFACE_API_KEY', 'HF_API_KEY')) {
    return true;
  }
  const tokenPath = envValue(env, 'HF_TOKEN_PATH');
  if (tokenPath && fileExists(tokenPath)) return true;
  const hfHome = envValue(env, 'HF_HOME');
  if (hfHome && fileExists(join(hfHome, 'token'))) return true;
  return fileExists(join(homedir(), '.cache', 'huggingface', 'token'));
}

function hasKaggleAuth(env: NodeJS.ProcessEnv): boolean {
  if (hasEnv(env, 'KAGGLE_API_TOKEN', 'KAGGLE_TOKEN')) return true;
  if (hasEnv(env, 'KAGGLE_USERNAME') && hasEnv(env, 'KAGGLE_KEY')) return true;
  const kaggleDir = envValue(env, 'KAGGLE_CONFIG_DIR') || join(homedir(), '.kaggle');
  return fileExists(join(kaggleDir, 'kaggle.json')) || fileExists(join(kaggleDir, 'access_token'));
}

function hasGitHubAuth(env: NodeJS.ProcessEnv): boolean {
  return hasEnv(env, 'GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_API_TOKEN');
}

function benchmarkAdapterPaths(): { label: string; path: string }[] {
  return [
    { label: 'Terminal-Bench adapter', path: join(packageRoot, 'resources', 'terminal_bench', 'grawkus_agent.py') },
    { label: 'KBench adapter', path: join(packageRoot, 'resources', 'kbench', 'grawkus_agent', 'runner.mjs') },
    { label: 'HAL adapter', path: join(packageRoot, 'resources', 'hal', 'grawkus_agent', 'main.py') },
    { label: 'Exgentic adapter', path: join(packageRoot, 'resources', 'exgentic', 'grawkus_agent', 'agent.py') },
    { label: 'Open Agent card', path: join(packageRoot, 'resources', 'open_agent_leaderboard', 'grawkus-agent-card.md') },
  ];
}

export function buildDoctorReport(options: DoctorOptions = {}): DoctorReport {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const includeRegistry = options.includeRegistry ?? true;
  const checks: DoctorCheck[] = [];

  add(checks, {
    id: 'node_version',
    label: 'Node runtime',
    status: versionAtLeast(process.versions.node, 18, 0, 0) ? 'pass' : 'fail',
    detail: `Node ${process.version}`,
    hint: 'Grawkus requires Node >=18.0.0.',
  });

  const packageFiles = [
    join(packageRoot, 'package.json'),
    join(packageRoot, 'bin', 'grawkus.js'),
    join(packageRoot, 'dist', 'index.js'),
  ];
  const missingPackageFiles = packageFiles.filter((path) => !fileExists(path));
  add(checks, {
    id: 'package_integrity',
    label: 'Package files',
    status: missingPackageFiles.length === 0 ? 'pass' : 'fail',
    detail: missingPackageFiles.length === 0
      ? 'package.json, bin/grawkus.js, and dist/index.js are present.'
      : `Missing ${missingPackageFiles.length} required package file(s).`,
    hint: missingPackageFiles.length > 0 ? `Run npm run build or reinstall Grawkus. Missing: ${missingPackageFiles.map((p) => p.replace(packageRoot, '.')).join(', ')}` : undefined,
  });

  const npm = commandResult('npm', ['--version'], { timeoutMs: 5000, cwd, env });
  add(checks, {
    id: 'npm_available',
    label: 'npm',
    status: npm.ok ? 'pass' : 'fail',
    detail: npm.ok ? `npm ${firstLine(npm.stdout)}` : `npm unavailable${npm.error ? ': ' + npm.error : ''}`,
    hint: npm.ok ? undefined : 'Install Node/npm or repair PATH before installing Grawkus globally.',
  });

  if (includeRegistry) {
    const registry = npm.ok
      ? commandResult('npm', ['view', pkg.name, 'version', '--json'], { timeoutMs: 10000, cwd, env })
      : null;
    let status: DoctorStatus = 'warn';
    let detail = 'Skipped because npm is unavailable.';
    if (registry) {
      const latest = firstLine(registry.stdout).replace(/^"|"$/g, '');
      if (registry.ok && latest === pkg.version) {
        status = 'pass';
        detail = `Registry latest matches local package (${pkg.version}).`;
      } else if (registry.ok && latest) {
        status = 'warn';
        detail = `Registry latest is ${latest}; local package is ${pkg.version}.`;
      } else {
        detail = registry.timedOut
          ? 'Registry check timed out.'
          : `Registry check failed${registry.error ? ': ' + registry.error : registry.stderr ? ': ' + firstLine(registry.stderr) : '.'}`;
      }
    }
    add(checks, {
      id: 'registry_latest',
      label: 'npm registry',
      status,
      detail,
      hint: status === 'pass' ? undefined : 'Run npm install -g grawkus@latest after registry metadata catches up.',
    });
  } else {
    add(checks, {
      id: 'registry_latest',
      label: 'npm registry',
      status: 'warn',
      detail: 'Skipped by --doctor-no-registry.',
    });
  }

  const lookupCommand = process.platform === 'win32' ? 'where.exe' : 'which';
  const grawkusLookup = commandResult(lookupCommand, ['grawkus'], { timeoutMs: 5000, cwd, env });
  add(checks, {
    id: 'global_binary',
    label: 'Global binary',
    status: grawkusLookup.ok ? 'pass' : 'warn',
    detail: grawkusLookup.ok ? `grawkus resolves on PATH (${firstLine(grawkusLookup.stdout)}).` : 'grawkus is not currently found on PATH.',
    hint: grawkusLookup.ok ? undefined : 'If this is a dev checkout, node bin/grawkus.js still works. For global use, run npm install -g grawkus@latest and reopen the shell.',
  });

  const git = commandResult('git', ['--version'], { timeoutMs: 5000, cwd, env });
  add(checks, {
    id: 'git_available',
    label: 'git',
    status: git.ok ? 'pass' : 'warn',
    detail: git.ok ? firstLine(git.stdout) : 'git unavailable or not on PATH.',
    hint: git.ok ? undefined : 'Many coding workflows use git diff/status/log for verification.',
  });

  const config = configSnapshot(env);
  add(checks, {
    id: 'config_file',
    label: 'Config file',
    status: config.exists && config.parseOk ? 'pass' : config.exists ? 'fail' : 'warn',
    detail: config.exists
      ? config.parseOk ? `Readable config at ${config.path}.` : `Config exists but is not valid JSON at ${config.path}.`
      : `No config file at ${config.path}.`,
    hint: config.exists ? undefined : 'Run grawkus once interactively, or use env config such as OPENROUTER_API_KEY and GRAWKUS_MODEL.',
  });

  const provider = providerPreset(config.config.provider, config.config.baseURL);
  const providerName = provider?.name || config.config.provider || 'Unknown provider';
  const model = config.config.model || provider?.defaultModel || '(no model)';
  const needsKey = providerRequiresKey(config.config);
  const codexStatus = getOpenAICodexAuthStatus(config.config as GrawkusConfig);
  const hasProviderAuth = !!config.config.apiKey || !!(config.config.apiKeys && config.config.apiKeys.length > 0) || codexStatus.available || !needsKey;
  add(checks, {
    id: 'provider_config',
    label: 'Provider config',
    status: hasProviderAuth && model !== '(no model)' ? 'pass' : 'warn',
    detail: `${providerName}, model ${model}, ${safeHost(config.config.baseURL || provider?.baseURL)}; auth ${hasProviderAuth ? 'configured' : 'missing'}.`,
    hint: hasProviderAuth ? undefined : 'Run /config, /openai-login, or provide the provider API key via environment.',
  });

  const compact = compactProvider(providerName);
  const openrouterModel = String(model || '');
  const openrouterFree =
    compact.includes('openrouter') &&
    (openrouterModel === 'openrouter/free' || /:free(?:$|[/?#])/.test(openrouterModel));
  add(checks, {
    id: 'openrouter_free_tier',
    label: 'OpenRouter free tier',
    status: compact.includes('openrouter') ? openrouterFree ? 'pass' : 'warn' : 'pass',
    detail: compact.includes('openrouter')
      ? openrouterFree ? 'Configured for OpenRouter free-tier routing.' : `OpenRouter model ${openrouterModel || '(missing)'} may require credits.`
      : 'Current provider is not OpenRouter.',
    hint: compact.includes('openrouter') && !openrouterFree ? 'Run /openrouter-free or grawkus --model openrouter/free for free-tier-only accounts.' : undefined,
  });

  const github = hasGitHubAuth(env);
  const hf = hasHuggingFaceAuth(env);
  const kaggle = hasKaggleAuth(env);
  const sourceResearchReady = github && hf && kaggle;
  add(checks, {
    id: 'research_auth',
    label: 'Source research readiness',
    status: sourceResearchReady ? 'pass' : 'warn',
    detail: [
      'arXiv public access available',
      `GitHub auth ${github ? 'found' : 'missing'}`,
      `Hugging Face auth ${hf ? 'found' : 'missing'}`,
      `Kaggle auth ${kaggle ? 'found' : 'missing'}`,
      `Kaggle competitions ${kaggle ? 'enabled' : 'disabled'}`,
    ].join('; ') + '.',
    hint: sourceResearchReady
      ? undefined
      : 'Source research still works partially, but leaderboard-grade coverage should set GITHUB_TOKEN or GH_TOKEN, HF_TOKEN, and KAGGLE_API_TOKEN or KAGGLE_USERNAME/KAGGLE_KEY.',
  });

  const mempalace = commandResult('mempalace', ['--version'], { timeoutMs: 5000, cwd, env });
  add(checks, {
    id: 'mempalace',
    label: 'MemPalace',
    status: mempalace.ok ? 'pass' : 'warn',
    detail: mempalace.ok ? `mempalace CLI available (${firstLine(mempalace.stdout) || 'version command ok'}).` : 'mempalace CLI is not available on PATH.',
    hint: mempalace.ok ? undefined : 'Memory slash commands can still use Grawkus local memory, but cross-agent MemPalace recall needs the CLI/service installed.',
  });

  const missingAdapters = benchmarkAdapterPaths().filter((entry) => !fileExists(entry.path));
  add(checks, {
    id: 'benchmark_adapters',
    label: 'Benchmark adapters',
    status: missingAdapters.length === 0 ? 'pass' : 'fail',
    detail: missingAdapters.length === 0
      ? 'Terminal-Bench, KBench, HAL, Exgentic, and Open Agent card files are present.'
      : `Missing ${missingAdapters.length} benchmark adapter artifact(s).`,
    hint: missingAdapters.length > 0 ? `Missing: ${missingAdapters.map((entry) => entry.label).join(', ')}.` : undefined,
  });

  add(checks, {
    id: 'cwd_writable',
    label: 'Current directory',
    status: dirWritable(cwd) ? 'pass' : 'warn',
    detail: dirWritable(cwd) ? `Writable working directory: ${cwd}.` : `Working directory is not writable: ${cwd}.`,
    hint: dirWritable(cwd) ? undefined : 'Some workflows need to write patches, traces, or temporary files in the project.',
  });

  const summary: Record<DoctorStatus, number> = { pass: 0, warn: 0, fail: 0 };
  for (const check of checks) summary[check.status]++;

  return {
    version: pkg.version,
    generatedAt: new Date().toISOString(),
    platform: `${process.platform} ${process.arch}`,
    nodeVersion: process.version,
    cwd,
    configDir: resolveDoctorConfigDir(env),
    checks,
    summary,
    hasFailures: summary.fail > 0,
  };
}

function statusLabel(status: DoctorStatus): string {
  if (status === 'pass') return chalk.green('PASS');
  if (status === 'fail') return chalk.red('FAIL');
  return chalk.yellow('WARN');
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push(chalk.cyan(`Grawkus Doctor ${report.version}`));
  lines.push(chalk.dim(`Generated: ${report.generatedAt}`));
  lines.push(chalk.dim(`Platform: ${report.platform}; Node: ${report.nodeVersion}`));
  lines.push('');
  for (const check of report.checks) {
    lines.push(`${statusLabel(check.status)} ${check.label}: ${check.detail}`);
    if (check.status !== 'pass' && check.hint) lines.push(chalk.dim(`  fix: ${check.hint}`));
  }
  lines.push('');
  const summary = `Summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`;
  lines.push(report.hasFailures ? chalk.red(summary) : report.summary.warn > 0 ? chalk.yellow(summary) : chalk.green(summary));
  return lines.join('\n');
}

export function runDoctorCli(options: { json?: boolean; includeRegistry?: boolean } = {}): DoctorReport {
  const report = buildDoctorReport({ includeRegistry: options.includeRegistry });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatDoctorReport(report)}\n`);
  }
  return report;
}

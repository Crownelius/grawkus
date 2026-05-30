import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { name?: string; version?: string };

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  error?: string;
}

export function getCurrentVersion(): string {
  return pkg.version || '0.0.0';
}

export function compareVersions(a: string, b: string): number {
  const parse = (value: string): { nums: number[]; pre: string } => {
    const clean = value.trim().replace(/^v/i, '');
    const [main, pre = ''] = clean.split('-', 2);
    const nums = main.split('.').map((part) => Number.parseInt(part, 10) || 0);
    while (nums.length < 3) nums.push(0);
    return { nums: nums.slice(0, 3), pre };
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i++) {
    if (left.nums[i] !== right.nums[i]) return left.nums[i] > right.nums[i] ? 1 : -1;
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre > right.pre ? 1 : -1;
}

function npmCommandArgs(args: string[]): { command: string; args: string[] } {
  if (process.platform !== 'win32') return { command: 'npm', args };
  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', ['npm', ...args].join(' ')],
  };
}

function runNpm(args: string[], timeoutMs: number): Promise<{ ok: boolean; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolve) => {
    const npm = npmCommandArgs(args);
    const child = spawn(npm.command, npm.args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (value: { ok: boolean; stdout: string; stderr: string; error?: string }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    let stdout = '';
    let stderr = '';
    timer = setTimeout(() => {
      try { child.kill(); } catch { /* noop */ }
      finish({ ok: false, stdout, stderr, error: 'timeout' });
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (err) => {
      finish({ ok: false, stdout, stderr, error: err.message });
    });
    child.on('close', (code) => {
      finish({ ok: code === 0, stdout, stderr });
    });
  });
}

function parseNpmVersion(stdout: string): string | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'string') return parsed.trim();
  } catch {
    // npm may return plain text depending on version/config.
  }
  return trimmed.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

export async function checkForUpdate(timeoutMs = 4000): Promise<UpdateCheckResult> {
  const currentVersion = getCurrentVersion();
  const result = await runNpm(['view', 'grawkus', 'version', '--json'], timeoutMs);
  if (!result.ok) {
    return {
      currentVersion,
      updateAvailable: false,
      error: result.error || result.stderr.trim() || 'npm view failed',
    };
  }
  const latestVersion = parseNpmVersion(result.stdout);
  if (!latestVersion) {
    return { currentVersion, updateAvailable: false, error: 'registry returned no version' };
  }
  return {
    currentVersion,
    latestVersion,
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
  };
}

export function startGlobalUpdateInstall(): boolean {
  try {
    const npm = npmCommandArgs(['install', '-g', 'grawkus@latest', '--force']);
    const child = spawn(npm.command, npm.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export function startStartupUpdateCheck(options: {
  onUpdateStarted?: (currentVersion: string, latestVersion: string) => void;
  onUpdateUnavailable?: (currentVersion: string) => void;
  onError?: (error: string) => void;
  env?: NodeJS.ProcessEnv;
} = {}): void {
  const env = options.env || process.env;
  const rawCheck = (env.GRAWKUS_UPDATE_CHECK || '').trim().toLowerCase();
  const rawAuto = (env.GRAWKUS_AUTO_UPDATE || '').trim().toLowerCase();
  if (env.GRAWKUS_NON_INTERACTIVE === '1') return;
  if (rawCheck === '0' || rawCheck === 'false' || rawCheck === 'off' || rawCheck === 'no') return;
  if (pkg.name && pkg.name !== 'grawkus') return;

  checkForUpdate().then((result) => {
    if (result.error) {
      options.onError?.(result.error);
      return;
    }
    if (!result.updateAvailable || !result.latestVersion) {
      options.onUpdateUnavailable?.(result.currentVersion);
      return;
    }
    const autoInstall = !(rawAuto === '0' || rawAuto === 'false' || rawAuto === 'off' || rawAuto === 'no');
    if (!autoInstall) {
      options.onError?.(`update available ${result.currentVersion} -> ${result.latestVersion}, auto-update disabled`);
      return;
    }
    if (startGlobalUpdateInstall()) {
      options.onUpdateStarted?.(result.currentVersion, result.latestVersion);
    } else {
      options.onError?.(`could not start npm install for ${result.latestVersion}`);
    }
  }).catch((err) => {
    options.onError?.(err instanceof Error ? err.message : String(err));
  });
}

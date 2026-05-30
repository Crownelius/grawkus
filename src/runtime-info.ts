import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function compactPath(cwd: string): string {
  return cwd.replace(/\\/g, '/');
}

function gitSummary(cwd: string): string {
  if (!existsSync(join(cwd, '.git'))) return 'not a git repo';
  try {
    const out = execFileSync('git', ['status', '--short'], {
      cwd,
      encoding: 'utf-8',
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!out) return 'clean';
    const lines = out.split(/\r?\n/).filter(Boolean);
    const shown = lines.slice(0, 8).join('; ');
    const extra = lines.length > 8 ? `; +${lines.length - 8} more` : '';
    return `${lines.length} changed: ${shown}${extra}`;
  } catch {
    return 'unknown';
  }
}

export function buildRuntimeInfoBlock(cwd: string, now: Date = new Date()): string {
  return [
    '<runtime_info>',
    `cwd: ${compactPath(cwd)}`,
    `time: ${now.toISOString()}`,
    `git: ${gitSummary(cwd)}`,
    '</runtime_info>',
  ].join('\n');
}

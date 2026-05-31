/**
 * ProMode slash command dispatch (keeps index.ts switch smaller).
 */

import chalk from 'chalk';
import type { GrawkusConfig } from '../types.js';
export interface PromodeSlashResult {
  handled: boolean;
  injectPrompt?: string;
  shouldExit?: boolean;
}
import {
  addCronJob,
  buildCronExport,
  formatCronList,
  listCronJobs,
  removeCronJob,
  setCronJobEnabled,
} from './cron.js';
import {
  addIdea,
  addLike,
  addTask,
  addWant,
  formatTilwStatusLine,
  loadPromodeState,
  setPromodeEnabled,
  setPromodeRunning,
} from './state.js';
import { persistDurableTilwFact } from './memory-context.js';
import { PROMODE_ACTIVATE_SENTINEL } from './consent.js';
import { stopPromodeLoop } from './loop.js';

export interface PromodeSlashOpts {
  cwd: string;
  config: GrawkusConfig;
  onStartLoop?: () => void;
}

function requirePromodeEnabled(state: ReturnType<typeof loadPromodeState>): boolean {
  if (state.enabled || state.running) return true;
  return false;
}

export function handlePromodeSlash(
  cmd: string,
  args: string,
  opts: PromodeSlashOpts,
): PromodeSlashResult | null {
  const { cwd, config } = opts;

  if (cmd === '/task') {
    if (!args.trim()) {
      console.log(chalk.yellow('  Usage: /task <description>'));
      return { handled: true };
    }
    addTask(args.trim(), cwd);
    console.log(chalk.green('  Queued T (task).'));
    return { handled: true };
  }
  if (cmd === '/idea') {
    if (!args.trim()) {
      console.log(chalk.yellow('  Usage: /idea <description>'));
      return { handled: true };
    }
    addIdea(args.trim(), cwd);
    persistDurableTilwFact('I', args.trim(), cwd);
    console.log(chalk.green('  Queued I (idea) + MemPalace promode/ideas.'));
    return { handled: true };
  }
  if (cmd === '/like') {
    if (!args.trim()) {
      console.log(chalk.yellow('  Usage: /like <description>'));
      return { handled: true };
    }
    addLike(args.trim(), cwd);
    persistDurableTilwFact('L', args.trim(), cwd);
    console.log(chalk.green('  Queued L (like).'));
    return { handled: true };
  }
  if (cmd === '/want') {
    if (!args.trim()) {
      console.log(chalk.yellow('  Usage: /want <description>'));
      return { handled: true };
    }
    addWant(args.trim(), cwd);
    persistDurableTilwFact('W', args.trim(), cwd);
    console.log(chalk.green('  Queued W (want).'));
    return { handled: true };
  }

  if (cmd !== '/promode' && cmd !== '/pro') return null;

  const parts = args.trim().split(/\s+/);
  const sub = (parts[0] || '').toLowerCase();
  const rest = parts.slice(1).join(' ').trim();

  if (!sub || sub === 'status') {
    const state = loadPromodeState(cwd);
    console.log(chalk.cyan(`  ${formatTilwStatusLine(state)}`));
    const budget = state.sessionTokenBudget ?? 0;
    if (budget > 0) {
      console.log(
        chalk.dim(
          `  Run token budget: ${(state.sessionTokensUsed ?? 0).toLocaleString()} / ${budget.toLocaleString()}`,
        ),
      );
    }
    console.log(chalk.dim(`  Quality: ${config.promode?.quality ?? 'standard'}`));
    console.log(chalk.dim('\n' + formatCronList()));
    return { handled: true };
  }

  if (sub === 'on') {
    return { handled: true, injectPrompt: PROMODE_ACTIVATE_SENTINEL };
  }

  if (sub === 'off' || sub === 'stop') {
    stopPromodeLoop(cwd);
    setPromodeEnabled(false, cwd);
    console.log(chalk.green('  ProMode STOPPED.'));
    return { handled: true };
  }

  if (sub === 'cron') {
    return handlePromodeCronSub(rest, opts);
  }

  // toggle
  const state = loadPromodeState(cwd);
  if (state.running) {
    stopPromodeLoop(cwd);
    setPromodeEnabled(false, cwd);
    console.log(chalk.green('  ProMode toggled OFF.'));
  } else {
    return { handled: true, injectPrompt: PROMODE_ACTIVATE_SENTINEL };
  }
  return { handled: true };
}

function handlePromodeCronSub(rest: string, opts: PromodeSlashOpts): PromodeSlashResult {
  const { cwd } = opts;
  const parts = rest.trim().split(/\s+/);
  const sub = (parts[0] || '').toLowerCase();
  const tail = parts.slice(1).join(' ').trim();

  if (sub === 'add') {
    const space = tail.indexOf(' ');
    if (space < 1) {
      console.log(chalk.yellow('  Usage: /promode cron add <schedule> <prompt>'));
      console.log(chalk.dim('  Schedule: 30s, 5m, 2h, 1d or cron "0 9 * * *"'));
      return { handled: true };
    }
    const schedule = tail.slice(0, space).trim();
    const prompt = tail.slice(space + 1).trim();
    try {
      const job = addCronJob({ schedule, prompt, cwd });
      console.log(chalk.green(`  Cron job ${job.id} created (${job.schedule}).`));
    } catch (e) {
      console.log(chalk.red(`  ${e instanceof Error ? e.message : e}`));
    }
    return { handled: true };
  }

  if (sub === 'list') {
    console.log(chalk.cyan('\n  ProMode cron jobs:\n'));
    console.log(formatCronList());
    return { handled: true };
  }

  if (sub === 'rm' || sub === 'remove') {
    if (!tail) {
      console.log(chalk.yellow('  Usage: /promode cron rm <id>'));
      return { handled: true };
    }
    console.log(removeCronJob(tail) ? chalk.green('  Removed.') : chalk.yellow('  Job not found.'));
    return { handled: true };
  }

  if (sub === 'enable' || sub === 'disable') {
    if (!tail) {
      console.log(chalk.yellow(`  Usage: /promode cron ${sub} <id>`));
      return { handled: true };
    }
    const job = setCronJobEnabled(tail, sub === 'enable');
    console.log(job ? chalk.green(`  ${job.id} ${sub}d.`) : chalk.yellow('  Job not found.'));
    return { handled: true };
  }

  if (sub === 'export') {
    console.log(chalk.cyan('\n' + buildCronExport(cwd)));
    return { handled: true };
  }

  console.log(chalk.yellow('  Usage: /promode cron add|list|rm|enable|disable|export'));
  return { handled: true };
}

export function enablePromodeMode(opts: PromodeSlashOpts): void {
  setPromodeEnabled(true, opts.cwd);
  setPromodeRunning(true, opts.cwd);
  opts.onStartLoop?.();
  console.log(chalk.green('  ProMode ON — TILW loop running until /promode stop'));
  console.log(chalk.yellow('  Warning: unlimited autonomous cycles may incur API cost.'));
}

export function pausePromodeIfLeavingMode(newMode: string, cwd: string): void {
  if (newMode !== 'promode') {
    const state = loadPromodeState(cwd);
    if (state.running) {
      stopPromodeLoop(cwd);
      console.log(chalk.dim('  ProMode loop paused (switch back with /mode promode or /promode on).'));
    }
  }
}

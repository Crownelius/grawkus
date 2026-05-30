/**
 * ProMode activation consent — cost warnings, accept / don't-ask-again, token budget.
 */

import type { Interface } from 'node:readline/promises';
import { stdin } from 'node:process';
import chalk from 'chalk';
import { getUsageSummary } from '../cost-tracker.js';
import {
  loadPromodeSafetyPrefs,
  savePromodeSafetyPrefs,
  setSkipActivationWarnings,
} from './safety-prefs.js';
import { loadPromodeState, mutatePromodeState } from './state.js';

export const PROMODE_ACTIVATE_SENTINEL = '__PROMODE_ACTIVATE__';

/** Shown sequentially on activation unless user opted out */
export const PROMODE_ACTIVATION_WARNINGS: readonly string[] = [
  'Warning: unlimited autonomous cycles may incur API cost.',
  'ProMode runs a background TILW loop (Tasks → Ideas → Likes → Wants) until you run /promode stop.',
  'Each cycle may invoke your configured model, tools, and MemPalace retrieval — charges apply per provider.',
  'Cron jobs and resumed sessions can restart the loop without a fresh slash command.',
  'Idle backoff reduces frequency but does not cap total spend while the loop is running.',
  'You are responsible for monitoring usage; set a token budget below to auto-stop this run.',
  'Accept only if you understand that ProMode may run continuously and bill your API account.',
] as const;

export const PROMODE_PERIODIC_WARNING =
  'Warning: unlimited autonomous cycles may incur API cost. (ProMode still running)';

export interface PromodeActivationResult {
  accepted: boolean;
  tokenBudget: number;
}

function isInteractive(): boolean {
  return Boolean(stdin.isTTY && process.env.GRAWKUS_PROMODE_SKIP_CONSENT !== '1');
}

function parseYes(input: string): boolean {
  const v = input.trim().toLowerCase();
  return v === 'y' || v === 'yes';
}

function parseDontAskAgain(input: string): boolean {
  const v = input.trim().toLowerCase();
  return v === 'd' || v === 'dna' || v.startsWith('don');
}

export function formatWarningBox(message: string, index?: number, total?: number): string {
  const label =
    index !== undefined && total !== undefined
      ? chalk.yellow.bold(`  ProMode cost notice (${index + 1}/${total})`)
      : chalk.yellow.bold('  ProMode cost notice');
  const border = chalk.yellow('  ┌' + '─'.repeat(58) + '┐');
  const bottom = chalk.yellow('  └' + '─'.repeat(58) + '┘');
  const body = chalk.yellow(`  │ ${message.padEnd(56).slice(0, 56)} │`);
  return [border, label, body, bottom].join('\n');
}

export async function promptAcceptWarning(
  rl: Interface,
  message: string,
  index?: number,
  total?: number,
): Promise<'accept' | 'decline' | 'dont-ask-again'> {
  console.log('\n' + formatWarningBox(message, index, total));
  const prompt =
    chalk.dim('  Accept to continue? ') +
    chalk.white('[y/N]') +
    chalk.dim(' · type ') +
    chalk.cyan('d') +
    chalk.dim(" = don't ask again for activation warnings: ");
  const answer = (await rl.question(prompt)).trim();
  if (parseDontAskAgain(answer)) return 'dont-ask-again';
  if (parseYes(answer)) return 'accept';
  return 'decline';
}

export async function promptTokenBudget(rl: Interface, previous?: number): Promise<number> {
  console.log(chalk.cyan('\n  ProMode run token budget'));
  console.log(
    chalk.dim(
      '  Optional cap for this activation only (prompt + completion tokens). 0 = unlimited until /promode stop.',
    ),
  );
  const hint = previous && previous > 0 ? String(previous) : '0';
  const raw = (
    await rl.question(chalk.dim(`  Token budget for this run [${hint}]: `))
  ).trim();
  if (!raw) return previous && previous > 0 ? previous : 0;
  const n = Number.parseInt(raw.replace(/,/g, ''), 10);
  if (!Number.isFinite(n) || n < 0) {
    console.log(chalk.yellow('  Invalid number — using 0 (unlimited).'));
    return 0;
  }
  return n;
}

export async function runPromodeActivationConsent(
  rl: Interface,
  cwd: string,
  sessionId: string,
): Promise<PromodeActivationResult> {
  if (!isInteractive()) {
    beginPromodeRunAccounting(cwd, sessionId, 0);
    return { accepted: true, tokenBudget: 0 };
  }

  const prefs = loadPromodeSafetyPrefs();
  if (!prefs.skipActivationWarnings) {
    for (let i = 0; i < PROMODE_ACTIVATION_WARNINGS.length; i++) {
      const step = await promptAcceptWarning(
        rl,
        PROMODE_ACTIVATION_WARNINGS[i],
        i,
        PROMODE_ACTIVATION_WARNINGS.length,
      );
      if (step === 'dont-ask-again') {
        setSkipActivationWarnings(true);
        break;
      }
      if (step === 'decline') {
        console.log(chalk.yellow('  ProMode not started — activation cancelled.'));
        return { accepted: false, tokenBudget: 0 };
      }
    }
    const updated = loadPromodeSafetyPrefs();
    updated.lastActivationAcceptedAt = new Date().toISOString();
    savePromodeSafetyPrefs(updated);
  } else {
    console.log(chalk.dim('  (ProMode activation warnings skipped — don\'t ask again is on.)'));
  }

  const prior = loadPromodeState(cwd).sessionTokenBudget;
  const tokenBudget = await promptTokenBudget(rl, prior);
  if (tokenBudget > 0) {
    console.log(
      chalk.green(
        `  Token budget set: ${tokenBudget.toLocaleString()} — loop stops when exceeded.`,
      ),
    );
  } else {
    console.log(chalk.dim('  No token budget — run continues until /promode stop.'));
  }

  beginPromodeRunAccounting(cwd, sessionId, tokenBudget);
  return { accepted: true, tokenBudget };
}

export function beginPromodeRunAccounting(
  cwd: string,
  sessionId: string,
  tokenBudget: number,
): void {
  const baseline = getUsageSummary(sessionId).session.tokens;
  mutatePromodeState(cwd, (s) => {
    s.sessionTokenBudget = tokenBudget;
    s.sessionTokensUsed = 0;
    s.usageBaselineTokens = baseline;
    s.activationStartedAt = new Date().toISOString();
  });
}

export function syncPromodeTokensFromSession(cwd: string, sessionId: string): number {
  const state = loadPromodeState(cwd);
  const sessionTotal = getUsageSummary(sessionId).session.tokens;
  const baseline = state.usageBaselineTokens ?? 0;
  const used = Math.max(0, sessionTotal - baseline);
  if (used !== state.sessionTokensUsed) {
    mutatePromodeState(cwd, (s) => {
      s.sessionTokensUsed = used;
    });
  }
  return used;
}

export function isPromodeTokenBudgetExceeded(cwd: string): boolean {
  const state = loadPromodeState(cwd);
  const budget = state.sessionTokenBudget ?? 0;
  if (budget <= 0) return false;
  return (state.sessionTokensUsed ?? 0) >= budget;
}

export function formatPromodeBudgetStatus(cwd: string): string | null {
  const state = loadPromodeState(cwd);
  const budget = state.sessionTokenBudget ?? 0;
  if (budget <= 0) return null;
  const used = state.sessionTokensUsed ?? 0;
  const pct = Math.min(100, Math.round((used / budget) * 100));
  return `ProMode tokens ${used.toLocaleString()}/${budget.toLocaleString()} (${pct}%)`;
}

export async function promptPeriodicCostWarning(rl: Interface): Promise<boolean> {
  const prefs = loadPromodeSafetyPrefs();
  if (prefs.skipPeriodicWarnings || prefs.skipActivationWarnings) return true;

  console.log('\n' + formatWarningBox(PROMODE_PERIODIC_WARNING));
  const prompt =
    chalk.dim('  Continue ProMode? ') +
    chalk.white('[y/N]') +
    chalk.dim(' · ') +
    chalk.cyan('d') +
    chalk.dim(" = don't ask again for periodic warnings: ");
  const answer = (await rl.question(prompt)).trim();
  if (parseDontAskAgain(answer)) {
    const p = loadPromodeSafetyPrefs();
    p.skipPeriodicWarnings = true;
    savePromodeSafetyPrefs(p);
    return true;
  }
  return parseYes(answer);
}

export function shouldShowPeriodicWarning(iterationCount: number, every = 5): boolean {
  if (iterationCount <= 0) return false;
  return iterationCount % every === 0;
}

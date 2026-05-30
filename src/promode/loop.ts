/**
 * ProMode background loop — schedules TILW cycles until /promode stop.
 */

import type { Interface } from 'node:readline/promises';
import chalk from 'chalk';
import type { GrawkusConfig } from '../types.js';
import type { PromodeState } from './types.js';
import {
  isPromodeTokenBudgetExceeded,
  promptPeriodicCostWarning,
  shouldShowPeriodicWarning,
  syncPromodeTokensFromSession,
} from './consent.js';
import { enqueueDueCronTasks } from './cron.js';
import { recordPromodeReflection, recordPromodeObservation } from './memory-context.js';
import { buildPromodeCyclePrompt } from './prompts.js';
import {
  loadPromodeState,
  savePromodeState,
} from './state.js';
import { advanceAfterCycle, pickNextTilwAction } from './tilw.js';

export interface PromodeLoopContext {
  cwd: string;
  config: GrawkusConfig;
  sessionId?: string;
  rl?: Interface;
  /** Returns true if user has typed ahead in the live queue */
  hasQueuedUserInput?: () => boolean;
  /** Returns true if runQuery is in flight */
  isQueryInFlight?: () => boolean;
  /** Run one ProMode cycle prompt through the agent */
  runCycle: (prompt: string, mode: 'promode') => Promise<void>;
}

let loopTimer: ReturnType<typeof setTimeout> | null = null;
let loopRunning = false;
let loopStopped = false;
let currentCtx: PromodeLoopContext | null = null;

export function isPromodeLoopRunning(): boolean {
  return loopRunning;
}

export function stopPromodeLoop(cwd: string): void {
  loopStopped = true;
  loopRunning = false;
  if (loopTimer) {
    clearTimeout(loopTimer);
    loopTimer = null;
  }
  const state = loadPromodeState(cwd);
  state.running = false;
  state.stopped = true;
  savePromodeState(state, cwd);
}

export function startPromodeLoop(ctx: PromodeLoopContext): void {
  currentCtx = ctx;
  loopStopped = false;
  const state = loadPromodeState(ctx.cwd);
  state.running = true;
  state.stopped = false;
  state.enabled = true;
  savePromodeState(state, ctx.cwd);
  scheduleNextTick(0);
}

export function schedulePromodeAfterTurn(ctx: PromodeLoopContext): void {
  if (!currentCtx) currentCtx = ctx;
  const state = loadPromodeState(ctx.cwd);
  if (!state.running || state.stopped || loopStopped) return;
  const delayMs = (ctx.config.promode?.loopDelay ?? 0.5) * 1000;
  scheduleNextTick(delayMs);
}

function scheduleNextTick(delayMs: number): void {
  if (loopTimer) clearTimeout(loopTimer);
  loopTimer = setTimeout(() => {
    void runOneTick().catch(() => {});
  }, Math.max(0, delayMs));
}

function stopForTokenBudget(ctx: PromodeLoopContext, used: number, budget: number): void {
  console.log(
    chalk.yellow(
      `  ProMode stopped: token budget reached (${used.toLocaleString()} / ${budget.toLocaleString()}).`,
    ),
  );
  stopPromodeLoop(ctx.cwd);
}

async function runOneTick(): Promise<void> {
  const ctx = currentCtx;
  if (!ctx || loopStopped) return;

  const state = loadPromodeState(ctx.cwd);
  if (!state.running || state.stopped) return;

  if (ctx.sessionId) {
    syncPromodeTokensFromSession(ctx.cwd, ctx.sessionId);
    if (isPromodeTokenBudgetExceeded(ctx.cwd)) {
      const fresh = loadPromodeState(ctx.cwd);
      stopForTokenBudget(ctx, fresh.sessionTokensUsed ?? 0, fresh.sessionTokenBudget ?? 0);
      return;
    }
  }

  if (
    ctx.rl &&
    shouldShowPeriodicWarning(state.iterationCount) &&
    !(await promptPeriodicCostWarning(ctx.rl))
  ) {
    console.log(chalk.yellow('  ProMode stopped — periodic cost warning declined.'));
    stopPromodeLoop(ctx.cwd);
    return;
  }

  if (ctx.hasQueuedUserInput?.()) {
    scheduleNextTick((ctx.config.promode?.loopDelay ?? 0.5) * 1000);
    return;
  }
  if (ctx.isQueryInFlight?.()) {
    scheduleNextTick(1000);
    return;
  }

  loopRunning = true;
  try {
    enqueueDueCronTasks(ctx.cwd);
    const fresh = loadPromodeState(ctx.cwd);
    const gitEvery = ctx.config.promode?.gitSnapshotInterval ?? 7;
    const includeGit = fresh.iterationCount > 0 && fresh.iterationCount % gitEvery === 0;
    const pick = pickNextTilwAction(fresh, ctx.cwd, {
      focusRotate: ctx.config.promode?.focusRotate ?? 24,
    });
    const prompt = buildPromodeCyclePrompt({
      pick,
      state: fresh,
      cwd: ctx.cwd,
      config: ctx.config,
      sessionId: ctx.sessionId,
      includeGit,
    });

    await ctx.runCycle(prompt, 'promode');

    if (ctx.sessionId) {
      syncPromodeTokensFromSession(ctx.cwd, ctx.sessionId);
      if (isPromodeTokenBudgetExceeded(ctx.cwd)) {
        const fresh = loadPromodeState(ctx.cwd);
        stopForTokenBudget(ctx, fresh.sessionTokensUsed ?? 0, fresh.sessionTokenBudget ?? 0);
        return;
      }
    }

    const after = loadPromodeState(ctx.cwd);
    advanceAfterCycle(after, pick);
    after.idleStreak = 0;
    if (after.iterationCount > 0 && after.iterationCount % 12 === 0) {
      recordPromodeReflection(
        ctx.cwd,
        `TILW reflection iter=${after.iterationCount} priority=${pick.priority} focus=${pick.focusCategory ?? 'n/a'} last=${pick.action.slice(0, 120)}`,
        ctx.sessionId,
      );
    }
    savePromodeState(after, ctx.cwd);

    if (!loopStopped && after.running && !after.stopped) {
      scheduleNextTick((ctx.config.promode?.loopDelay ?? 0.5) * 1000);
    }
  } catch (err) {
    const after = loadPromodeState(ctx.cwd);
    after.idleStreak += 1;
    const maxBackoff = (ctx.config.promode?.idleBackoffMax ?? 12) * 1000;
    const backoff = Math.min(maxBackoff, (ctx.config.promode?.loopDelay ?? 0.5) * 1000 * Math.pow(2, after.idleStreak));
    recordPromodeObservation(
      ctx.cwd,
      `Loop error: ${err instanceof Error ? err.message : String(err)}`,
      ctx.sessionId,
    );
    savePromodeState(after, ctx.cwd);
    if (!loopStopped && after.running) scheduleNextTick(backoff);
  } finally {
    loopRunning = false;
  }
}

export function getPromodeLoopDelayForFooter(_config: GrawkusConfig, cwd?: string): string | null {
  const root = cwd ?? currentCtx?.cwd ?? process.cwd();
  const state = loadPromodeState(root);
  if (!state.running) return null;
  const budget = state.sessionTokenBudget ?? 0;
  const budgetBit =
    budget > 0
      ? ` tok ${(state.sessionTokensUsed ?? 0)}/${budget}`
      : '';
  return `ProMode:${state.currentPriority}#${state.iterationCount}${budgetBit}`;
}

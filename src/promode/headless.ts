/**
 * Headless ProMode cron execution for `grawkus promode cron run`.
 */

import type * as readline from 'node:readline/promises';
import type { GrawkusConfig, Message } from '../types.js';
import { runQuery } from '../query.js';
import { buildPromodeCyclePrompt } from './prompts.js';
import {
  enqueueDueCronTasks,
  getDueCronJobs,
  listCronJobs,
  markCronJobRun,
} from './cron.js';
import { loadPromodeState, savePromodeState } from './state.js';
import { pickNextTilwAction, advanceAfterCycle } from './tilw.js';

export async function runHeadlessPromodeCron(opts: {
  config: GrawkusConfig;
  cwd: string;
  jobId?: string;
  dueOnly?: boolean;
  sessionId?: string;
  rl: readline.Interface;
}): Promise<number> {
  const messages: Message[] = [];
  const state = loadPromodeState(opts.cwd);
  state.running = true;
  state.enabled = true;
  savePromodeState(state, opts.cwd);

  enqueueDueCronTasks(opts.cwd);

  let jobs = listCronJobs().filter((j) => j.enabled);
  if (opts.jobId) {
    jobs = jobs.filter((j) => j.id === opts.jobId || j.name === opts.jobId);
  } else if (opts.dueOnly) {
    jobs = getDueCronJobs();
  }
  if (jobs.length === 0 && !opts.dueOnly && !opts.jobId) {
    const pick = pickNextTilwAction(loadPromodeState(opts.cwd), opts.cwd, {});
    const prompt = buildPromodeCyclePrompt({
      pick,
      state: loadPromodeState(opts.cwd),
      cwd: opts.cwd,
      config: opts.config,
      sessionId: opts.sessionId,
    });
    messages.push({ role: 'user', content: prompt });
    const cfg = { ...opts.config };
    const maxPer = cfg.promode?.maxTurnsPerCycle;
    if (maxPer && maxPer > 0) cfg.maxTurns = maxPer;
    await runQuery({
      config: cfg,
      messages,
      cwd: opts.cwd,
      rl: opts.rl,
      sessionId: opts.sessionId ?? 'promode-cron',
      mode: 'promode',
    });
    return 0;
  }

  for (const job of jobs) {
    const prompt = `[ProMode:Cron:${job.id}] ${job.prompt}`;
    messages.push({ role: 'user', content: prompt });
    markCronJobRun(job.id);
    const cfg = { ...opts.config };
    const maxPer = cfg.promode?.maxTurnsPerCycle;
    if (maxPer && maxPer > 0) cfg.maxTurns = maxPer;
    await runQuery({
      config: cfg,
      messages,
      cwd: job.cwd ?? opts.cwd,
      rl: opts.rl,
      sessionId: opts.sessionId ?? `promode-cron-${job.id}`,
      mode: 'promode',
    });
  }

  const after = loadPromodeState(opts.cwd);
  const pick = pickNextTilwAction(after, opts.cwd, {});
  advanceAfterCycle(after, pick);
  savePromodeState(after, opts.cwd);
  return 0;
}

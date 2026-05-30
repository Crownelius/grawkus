/**
 * ProMode cron job persistence and due-job handling.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getHomeStateDir } from '../config.js';
import type { PromodeCronJob, PromodeCronStore } from './types.js';
import { getNextRunAt, isScheduleDue, parseSchedule } from './cron-parse.js';
import { addTask } from './state.js';

const CRON_FILE = 'cron.json';

export function getCronStorePath(): string {
  return join(getHomeStateDir(), 'promode', CRON_FILE);
}

function ensureCronDir(): void {
  mkdirSync(join(getHomeStateDir(), 'promode'), { recursive: true });
}

export function loadCronStore(): PromodeCronStore {
  const path = getCronStorePath();
  if (!existsSync(path)) return { jobs: [] };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as PromodeCronStore;
    return { jobs: Array.isArray(raw.jobs) ? raw.jobs : [] };
  } catch {
    return { jobs: [] };
  }
}

export function saveCronStore(store: PromodeCronStore): void {
  ensureCronDir();
  writeFileSync(getCronStorePath(), JSON.stringify(store, null, 2), 'utf-8');
}

function newId(): string {
  return `cron-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function addCronJob(opts: {
  schedule: string;
  prompt: string;
  name?: string;
  cwd?: string;
}): PromodeCronJob {
  parseSchedule(opts.schedule);
  const store = loadCronStore();
  const job: PromodeCronJob = {
    id: newId(),
    name: opts.name ?? opts.prompt.slice(0, 40),
    schedule: opts.schedule.trim(),
    prompt: opts.prompt.trim(),
    enabled: true,
    createdAt: new Date().toISOString(),
    cwd: opts.cwd,
  };
  store.jobs.push(job);
  saveCronStore(store);
  return job;
}

export function removeCronJob(id: string): boolean {
  const store = loadCronStore();
  const before = store.jobs.length;
  store.jobs = store.jobs.filter((j) => j.id !== id && j.name !== id);
  saveCronStore(store);
  return store.jobs.length < before;
}

export function setCronJobEnabled(id: string, enabled: boolean): PromodeCronJob | null {
  const store = loadCronStore();
  const job = store.jobs.find((j) => j.id === id || j.name === id);
  if (!job) return null;
  job.enabled = enabled;
  saveCronStore(store);
  return job;
}

export function listCronJobs(): PromodeCronJob[] {
  return loadCronStore().jobs;
}

export function getDueCronJobs(now: Date = new Date()): PromodeCronJob[] {
  return loadCronStore().jobs.filter((j) => {
    if (!j.enabled) return false;
    return isScheduleDue(j.schedule, j.lastRunAt, now);
  });
}

export function markCronJobRun(id: string): void {
  const store = loadCronStore();
  const job = store.jobs.find((j) => j.id === id);
  if (!job) return;
  job.lastRunAt = new Date().toISOString();
  saveCronStore(store);
}

export function enqueueDueCronTasks(cwd: string): PromodeCronJob[] {
  const due = getDueCronJobs();
  for (const job of due) {
    addTask(`[ProMode:Cron:${job.id}] ${job.prompt}`, cwd);
    markCronJobRun(job.id);
  }
  return due;
}

export function formatCronList(): string {
  const jobs = listCronJobs();
  if (jobs.length === 0) return 'No ProMode cron jobs. Add with: /promode cron add <schedule> <prompt>';
  const lines = jobs.map((j) => {
    const next = getNextRunAt(j.schedule, j.lastRunAt);
    const nextStr = next ? next.toISOString() : '—';
    return `  ${j.enabled ? '✓' : '○'} ${j.id}  ${j.schedule}  next≈${nextStr}\n      ${j.prompt.slice(0, 80)}${j.prompt.length > 80 ? '…' : ''}`;
  });
  return lines.join('\n');
}

export function buildCronExport(cwd: string): string {
  const grawkus = process.platform === 'win32' ? 'grawkus' : 'grawkus';
  const dueCmd = `${grawkus} promode cron run --due-only`;
  if (process.platform === 'win32') {
    return [
      '# Windows Task Scheduler (run daily at 9:00 — adjust /SC and /ST)',
      `schtasks /Create /TN "GrawkusProModeCron" /TR "${dueCmd}" /SC DAILY /ST 09:00 /F`,
      '',
      '# Or run a specific job:',
      `${grawkus} promode cron run --job <job-id>`,
      '',
      `cwd: ${cwd}`,
    ].join('\n');
  }
  return [
    '# crontab example (every 5 minutes, due jobs only)',
    `*/5 * * * * cd ${cwd} && ${dueCmd} >> ~/.grawkus/promode/cron.log 2>&1`,
    '',
    '# Single job:',
    `${grawkus} promode cron run --job <job-id>`,
  ].join('\n');
}

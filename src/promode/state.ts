/**
 * ProMode persisted state — global ~/.grawkus/promode/state.json plus optional
 * project overlay at <cwd>/.grawkus/promode/state.json for project-scoped queues.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getHomeStateDir, getProjectStateDir } from '../config.js';
import type { PromodeState, TilwPriority, TilwQueueItem } from './types.js';

const PROMODE_DIR = 'promode';
const STATE_FILE = 'state.json';

export function getGlobalStatePath(): string {
  return join(getHomeStateDir(), PROMODE_DIR, STATE_FILE);
}

export function getProjectStatePath(cwd: string): string {
  return join(getProjectStateDir(cwd), PROMODE_DIR, STATE_FILE);
}

export function createDefaultPromodeState(): PromodeState {
  return {
    enabled: false,
    running: false,
    stopped: true,
    iterationCount: 0,
    lastAction: '',
    idleStreak: 0,
    focusIndex: 0,
    currentPriority: 'T',
    tasks: [],
    ideas: [],
    likes: [],
    wants: [],
    completedTasks: [],
  };
}

function ensureDirFor(filePath: string): void {
  const dir = join(filePath, '..');
  mkdirSync(dir, { recursive: true });
}

function readStateFile(path: string): Partial<PromodeState> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Partial<PromodeState>;
  } catch {
    return null;
  }
}

function mergeState(base: PromodeState, patch: Partial<PromodeState> | null): PromodeState {
  if (!patch) return base;
  return {
    ...base,
    ...patch,
    tasks: patch.tasks ?? base.tasks,
    ideas: patch.ideas ?? base.ideas,
    likes: patch.likes ?? base.likes,
    wants: patch.wants ?? base.wants,
    completedTasks: patch.completedTasks ?? base.completedTasks,
  };
}

export function loadPromodeState(cwd: string): PromodeState {
  const base = createDefaultPromodeState();
  const global = readStateFile(getGlobalStatePath());
  let state = mergeState(base, global);
  const project = readStateFile(getProjectStatePath(cwd));
  if (project) {
    state = mergeState(state, {
      ...project,
      tasks: [...(global?.tasks ?? state.tasks), ...(project.tasks ?? [])],
      ideas: [...(global?.ideas ?? state.ideas), ...(project.ideas ?? [])],
    });
  }
  state.lastCwd = cwd;
  return state;
}

export function savePromodeState(state: PromodeState, cwd: string): void {
  state.lastCwd = cwd;
  const globalPath = getGlobalStatePath();
  ensureDirFor(globalPath);
  writeFileSync(globalPath, JSON.stringify(state, null, 2), 'utf-8');
}

export function mutatePromodeState(
  cwd: string,
  fn: (state: PromodeState) => void,
): PromodeState {
  const state = loadPromodeState(cwd);
  fn(state);
  savePromodeState(state, cwd);
  return state;
}

function pushQueue(
  queue: TilwQueueItem[],
  text: string,
): TilwQueueItem {
  const item: TilwQueueItem = {
    text: text.trim(),
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  queue.push(item);
  return item;
}

export function addTask(text: string, cwd: string): TilwQueueItem {
  let added!: TilwQueueItem;
  mutatePromodeState(cwd, (s) => { added = pushQueue(s.tasks, text); });
  return added;
}

export function addIdea(text: string, cwd: string): TilwQueueItem {
  let added!: TilwQueueItem;
  mutatePromodeState(cwd, (s) => { added = pushQueue(s.ideas, text); });
  return added;
}

export function addLike(text: string, cwd: string): TilwQueueItem {
  let added!: TilwQueueItem;
  mutatePromodeState(cwd, (s) => { added = pushQueue(s.likes, text); });
  return added;
}

export function addWant(text: string, cwd: string): TilwQueueItem {
  let added!: TilwQueueItem;
  mutatePromodeState(cwd, (s) => { added = pushQueue(s.wants, text); });
  return added;
}

export function setPromodeRunning(running: boolean, cwd: string): PromodeState {
  return mutatePromodeState(cwd, (s) => {
    s.running = running;
    s.stopped = !running;
    if (running) {
      s.enabled = true;
      s.stopped = false;
    }
  });
}

export function setPromodeEnabled(enabled: boolean, cwd: string): PromodeState {
  return mutatePromodeState(cwd, (s) => {
    s.enabled = enabled;
    if (!enabled) {
      s.running = false;
      s.stopped = true;
    }
  });
}

export function getTilwSummary(state: PromodeState): {
  tasks: { pending: number; in_progress: number; done: number };
  ideas: { pending: number; in_progress: number; done: number };
  likes: { pending: number; in_progress: number; done: number };
  wants: { pending: number; in_progress: number; done: number };
} {
  const count = (items: TilwQueueItem[]) => ({
    pending: items.filter((i) => i.status === 'pending').length,
    in_progress: items.filter((i) => i.status === 'in_progress').length,
    done: items.filter((i) => i.status === 'done').length,
  });
  return {
    tasks: count(state.tasks),
    ideas: count(state.ideas),
    likes: count(state.likes),
    wants: count(state.wants),
  };
}

export function formatTilwStatusLine(state: PromodeState): string {
  const s = getTilwSummary(state);
  const run = state.running ? 'running' : state.enabled ? 'enabled' : 'off';
  return (
    `ProMode ${run} | iter ${state.iterationCount} | ` +
    `T ${s.tasks.pending}p/${s.tasks.done}d ` +
    `I ${s.ideas.pending}p ` +
    `L ${s.likes.pending}p ` +
    `W ${s.wants.pending}p ` +
    `| focus ${state.currentPriority}`
  );
}

export function markQueueItemInProgress(
  state: PromodeState,
  priority: TilwPriority,
  item: TilwQueueItem,
): void {
  item.status = 'in_progress';
  state.currentPriority = priority;
  state.lastAction = item.text;
}

export function markQueueItemDone(
  state: PromodeState,
  priority: TilwPriority,
  item: TilwQueueItem,
): void {
  item.status = 'done';
  item.completedAt = new Date().toISOString();
  if (priority === 'T') {
    state.completedTasks.push(item);
    state.tasks = state.tasks.filter((t) => t !== item);
  }
}

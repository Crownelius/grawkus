/** ProMode TILW priority letter */
export type TilwPriority = 'T' | 'I' | 'L' | 'W';

export type QueueItemStatus = 'pending' | 'in_progress' | 'done';

export interface TilwQueueItem {
  text: string;
  status: QueueItemStatus;
  createdAt: string;
  completedAt?: string;
}

export interface PromodeState {
  enabled: boolean;
  running: boolean;
  stopped: boolean;
  iterationCount: number;
  lastAction: string;
  idleStreak: number;
  focusIndex: number;
  currentPriority: TilwPriority;
  tasks: TilwQueueItem[];
  ideas: TilwQueueItem[];
  likes: TilwQueueItem[];
  wants: TilwQueueItem[];
  completedTasks: TilwQueueItem[];
  lastCwd?: string;
  /** Per-activation token cap; 0 = unlimited */
  sessionTokenBudget?: number;
  /** Tokens consumed this activation (prompt + completion) */
  sessionTokensUsed?: number;
  /** Session token total at activation start (cost-tracker baseline) */
  usageBaselineTokens?: number;
  activationStartedAt?: string;
}

export interface TilwPickResult {
  priority: TilwPriority;
  action: string;
  reasoning: string;
  focusCategory?: string;
  queueItem?: TilwQueueItem;
}

export interface PromodeCronJob {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  cwd?: string;
}

export interface PromodeCronStore {
  jobs: PromodeCronJob[];
}
